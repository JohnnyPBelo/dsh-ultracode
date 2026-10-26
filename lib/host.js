import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region lib/types/routing.js
/**
* Tier selection: which catalog entry each UltraCode role runs on for a given
* cost mode. Pure resolution only — capability probing lives in `./vision.ts`,
* where a model must actually be asked about its input modalities.
*
* @module @deepseek-ai/dsh-ultracode/routing
*/
/**
* Pick the catalog entry a role uses when the deployment named none.
*
* The catalog order is the whole ranking: `maximum` takes the first entry for
* every role, while `frugal` takes the first for validation (the judge is where
* a mistake is most expensive to miss) and the last for coding (the volume
* role). A single-entry catalog therefore behaves identically in both modes.
* @param mode - the active cost mode.
* @param role - the role being resolved.
* @param catalog - the deployment's ordered routes, best first.
* @returns the selected route.
*/
function tierRoute(mode, role, catalog) {
	const best = catalog[0];
	const cheapest = catalog[catalog.length - 1];
	if (best === void 0 || cheapest === void 0) throw new RangeError("ultracode model catalog must contain at least one route");
	if (mode === "maximum") return best;
	return role === "validator" ? best : cheapest;
}
/**
* Resolve the route each role runs on.
*
* An explicit per-role route always wins over tier selection, so a deployment
* can pin one role's model without disturbing the mode's other choices.
* @param mode - the active cost mode.
* @param roles - deployment-pinned per-role routes, if any.
* @param catalog - the deployment's ordered routes, best first.
* @returns the resolved route per role.
*/
function resolveRoleRoutes(mode, roles, catalog) {
	return {
		coder: roles.coder ?? tierRoute(mode, "coder", catalog),
		validator: roles.validator ?? tierRoute(mode, "validator", catalog),
		...roles.vision === void 0 ? {} : { vision: roles.vision }
	};
}
/**
* Whether a request addressed to one route must be handed to another because
* the addressed model cannot accept images.
* @param carriesImages - whether the work actually includes image content.
* @param hasImageInput - the addressed model's image capability, where an
*   explicit omission is negative capability.
* @returns whether a vision handoff is required.
*/
function needsVisionHandoff(carriesImages, hasImageInput) {
	return carriesImages && !hasImageInput;
}
//#endregion
//#region lib/types/effort.js
/**
* Reasoning effort: the second half of a route.
*
* Claude Code's tallest effort rung is what UltraCode's `maximum` mode is
* modelled on, so a route names both the model and the effort level on that
* model's ladder. Adapters declare their ladder per model and reject an id they
* do not expose, so the id a catalog names is narrowed against the live
* capability before it reaches a request.
*
* A catalog entry whose effort a model does not expose still routes: the effort
* is dropped rather than failing the delegation, matching the reference
* behaviour where a model without the rung simply runs at its own default.
*
* @module @deepseek-ai/dsh-ultracode/effort
*/
/**
* Resolve the effort a route actually runs at on its own model.
*
* Both an absent catalog effort and a model that does not expose it resolve to
* `undefined`, which leaves the adapter's configured default in force.
* @param llm - the LLM service resolving model metadata.
* @param route - the provider/model route and the effort the catalog named.
* @param signal - optional cancellation for adapter-owned lookup.
* @returns the validated effort id, or `undefined` when the model does not expose it.
*/
async function resolveRouteEffort(llm, route, signal) {
	if (route.effort === void 0) return void 0;
	let info;
	try {
		info = await llm.resolveModelInfo(route.provider, route.model, signal);
	} catch {
		return;
	}
	return info.reasoning?.efforts.find((effort) => effort.id === route.effort)?.id;
}
//#endregion
//#region lib/types/vision.js
/**
* Vision capability resolution: which route reads images when the selected
* subagent model cannot.
*
* `LlmModelInfo.inputModalities` is the only capability source: absent means
* unknown, and both unknown and an explicit text-only omission are treated as
* negative capability. A model is never assumed to accept images because a
* request would otherwise be convenient.
*
* @module @deepseek-ai/dsh-ultracode/vision
*/
/**
* Read one route's declared input modalities.
*
* A provider that cannot resolve the model is reported as unknown rather than
* thrown: caller policy decides whether unknown capability blocks the work.
* @param llm - the LLM service resolving model metadata.
* @param route - the provider/model route to inspect.
* @param signal - optional cancellation for adapter-owned lookup.
* @returns the declared modalities, or `undefined` when unknown.
*/
async function readInputModalities(llm, route, signal) {
	try {
		return (await llm.resolveModelInfo(route.provider, route.model, signal)).inputModalities;
	} catch {
		return;
	}
}
/**
* Whether a route accepts image input.
* @param llm - the LLM service resolving model metadata.
* @param route - the route to inspect.
* @param signal - optional cancellation for adapter-owned lookup.
* @returns whether the model declares `image` among its input modalities.
*/
async function acceptsImages(llm, route, signal) {
	const modalities = await readInputModalities(llm, route, signal);
	return modalities !== void 0 && modalities.includes("image");
}
/**
* Resolve the route that reads images for a coder that cannot.
*
* An explicitly pinned vision route is used as given and is still verified: a
* deployment that pins a text-only model has a configuration mistake worth
* reporting, not a handoff worth attempting. Otherwise the catalog is searched
* in its configured order so the operator's ranking decides which capable model
* serves.
* @param llm - the LLM service resolving model metadata.
* @param pinned - the deployment's explicit vision route, if any.
* @param catalog - routes to search in order when nothing is pinned.
* @param signal - optional cancellation for adapter-owned lookup.
* @returns the resolved vision route, or why none is available.
*/
async function resolveVisionRoute(llm, pinned, catalog, signal) {
	if (pinned !== void 0) {
		if (await acceptsImages(llm, pinned, signal)) return {
			kind: "available",
			route: pinned
		};
		return {
			kind: "unavailable",
			reason: "unresolved",
			detail: `the pinned vision model "${pinned.model}" does not declare image input`
		};
	}
	for (const route of catalog) if (await acceptsImages(llm, route, signal)) return {
		kind: "available",
		route
	};
	return {
		kind: "unavailable",
		reason: "no-vision-model",
		detail: catalog.length === 0 ? "no UltraCode model catalog is configured, so no image-capable route can be selected" : "no configured UltraCode model declares image input"
	};
}
//#endregion
//#region lib/types/index.js
/**
* UltraCode is per-session deep-work policy: while active, a deployment-owned
* guidance section instructs the model to decompose a substantive task across
* parallel subagents and to validate the result before reporting, and the
* routing policy decides which model each role runs on.
*
* The state in force is folded from the session log (`ultracode/mode`, last one
* wins), so resume and fork restore it without a live mirror. User selections
* remain pending until the next accepted in-turn pre-step.
*
* Routing is enforced where the decision is made, not where it is described:
* a child that the policy routes runs on the resolved role route through
* `AgentOptions`, while the session's own route is never rewritten — the parent
* keeps the model the user selected.
*
* @module @deepseek-ai/dsh-ultracode
*/
/** The command that switches UltraCode on, off, or between modes. */
const ULTRACODE_COMMAND = "ultracode";
/** Validates the wire payload this unit's `view` produces. */
const VIEW_SCHEMA = z.object({
	active: z.boolean(),
	mode: z.union([z.literal("maximum"), z.literal("frugal")]),
	pending: z.boolean()
});
/** Config schema for the Loader. */
const Config = z.object({
	section: z.string(),
	catalog: z.object({ routes: z.array(z.object({
		provider: z.string().min(1),
		model: z.string().min(1),
		effort: z.string().min(1).optional()
	})).min(1) }),
	roles: z.object({
		coder: z.object({
			provider: z.string().min(1),
			model: z.string().min(1),
			effort: z.string().min(1).optional()
		}).optional(),
		validator: z.object({
			provider: z.string().min(1),
			model: z.string().min(1),
			effort: z.string().min(1).optional()
		}).optional(),
		vision: z.object({
			provider: z.string().min(1),
			model: z.string().min(1),
			effort: z.string().min(1).optional()
		}).optional()
	}).optional(),
	mode: z.union([z.literal("maximum"), z.literal("frugal")]).optional(),
	keyword: z.string().min(1).optional(),
	reminderEveryTurns: z.number().int().min(0).max(1024).optional()
});
/**
* Fold UltraCode state from the session log. The last `ultracode/mode` wins; a
* prefix with none is inactive in `fallback.mode`.
*
* The fallback is the deployment's configured mode: a session that has never
* committed one still reads that mode, which is what the projection reports and
* what `/ultracode` would turn on. Folding to `maximum` regardless would make a
* pre-configured `frugal` deployment route on one tier and display another.
* @param events - the session log or any prefix of it.
* @param end - fold `events[0, end)`; defaults to the whole log.
* @param fallback - the state a prefix with no `ultracode/mode` reads.
* @returns the state in force.
*/
function foldUltraCode(events, end = events.length, fallback = {
	active: false,
	mode: "maximum"
}) {
	let state = fallback;
	let index = 0;
	for (const event of events) {
		if (index >= end) break;
		index++;
		if (event.type === "ultracode/mode") state = {
			active: event.data.active,
			mode: event.data.mode
		};
	}
	return state;
}
/** Parse a mode word from command input. */
function parseMode(raw) {
	const token = raw.trim().toLowerCase();
	if (token === "maximum" || token === "max") return "maximum";
	if (token === "frugal" || token === "save") return "frugal";
}
/** The user-facing description of one selected state. */
function describeTarget(target) {
	return target.active ? `UltraCode on (${target.mode})` : "UltraCode off";
}
/**
* Validate deployment config at load rather than at first use.
* @param config - raw plugin config.
* @returns a detached validated config.
*/
function resolveConfig(config) {
	if (typeof config.section !== "string" || config.section.trim() === "") throw new Error("UltraCodeConfig needs a non-empty string `section`");
	const routes = config.catalog.routes;
	if (routes.length === 0) throw new Error("UltraCodeConfig needs `catalog.routes` with at least one provider/model route — UltraCode never invents a model order");
	return {
		section: config.section,
		catalog: { routes: routes.map((route) => ({
			provider: route.provider,
			model: route.model,
			...route.effort === void 0 ? {} : { effort: route.effort }
		})) },
		...config.roles === void 0 ? {} : { roles: config.roles },
		...config.mode === void 0 ? {} : { mode: config.mode },
		...config.keyword === void 0 ? {} : { keyword: config.keyword },
		...config.reminderEveryTurns === void 0 ? {} : { reminderEveryTurns: config.reminderEveryTurns }
	};
}
/**
* UltraCode's session policy and model-routing service.
*
* The service exposes routing so other plugins (a delegation tool, an
* orchestration UI) ask UltraCode which route a role should run on instead of
* duplicating tier logic.
*/
var UltraCodeController = class extends Service {
	static inject = ["llm", "systemPrompt"];
	config;
	pendingIntents = /* @__PURE__ */ new WeakMap();
	/** The state a session that never committed a mode reads. */
	fallback = {
		active: false,
		mode: "maximum"
	};
	constructor(ctx, config) {
		super(ctx, "ultracode");
		this.config = resolveConfig(config);
		this.fallback = {
			active: false,
			mode: this.config.mode ?? "maximum"
		};
		ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
			const decision = await next();
			if (decision.kind === "reject" || signal.aborted) return decision;
			if (this.requestedByKeyword(messages)) this.pendingIntents.set(agent.session, {
				active: true,
				mode: this.fold(agent.session).mode
			});
			const pending = this.pendingIntents.get(agent.session);
			if (pending !== void 0) {
				const narration = this.narration(agent.session, pending);
				try {
					this.commit(agent.session, pending);
				} catch (error) {
					ctx.logger.warn("dsh-ultracode: failed to append selected mode at step start: %o", error);
					return decision;
				}
				return narration === void 0 ? decision : {
					...decision,
					messages: [...decision.messages, narration]
				};
			}
			const reminder = this.reminder(agent.session, turn, step);
			return reminder === void 0 ? decision : {
				...decision,
				messages: [...decision.messages, reminder]
			};
		});
		ctx.systemPrompt.section({
			name: "ultracode:policy",
			order: 51,
			text: (context) => {
				if (context.agent === void 0) return "";
				const state = this.pendingIntents.get(context.agent.session) ?? this.fold(context.agent.session);
				return state.active ? this.sectionText(state) : "";
			}
		});
		ctx.on("agent/request", async ({ agent, signal }, next) => {
			const resolved = await next();
			const routed = agent.options.ultracodeEffort;
			const own = routed === void 0 && this.isDeepWork(agent) ? this.ownEffort(agent) : void 0;
			const wanted = routed ?? own;
			if (wanted === void 0) return resolved;
			const effort = await resolveRouteEffort(ctx.llm, {
				provider: resolved.provider,
				model: resolved.model,
				effort: wanted
			}, signal);
			return effort === void 0 ? resolved : {
				...resolved,
				reasoningEffort: effort
			};
		}, { global: true });
		ctx.inject(["sessionProjections"], (projectionCtx) => {
			projectionCtx.sessionProjections.register({
				key: "ultracode",
				schema: VIEW_SCHEMA,
				init: () => ({
					active: false,
					mode: this.config.mode ?? "maximum",
					wanted: null,
					running: null
				}),
				apply: (state, event) => {
					if (event.type === "command/run" && event.data.name === "ultracode") {
						const raw = event.data.args;
						if (raw === void 0) return state;
						const target = this.commandTarget(raw, {
							active: state.active,
							mode: state.mode
						});
						return target === void 0 ? state : {
							...state,
							running: {
								commandId: event.data.commandId,
								target
							}
						};
					}
					if (event.type === "command/done" && event.data.commandId === state.running?.commandId) {
						const wanted = event.data.kind === "success" ? state.running.target : null;
						return {
							...state,
							wanted,
							running: null
						};
					}
					if (event.type === "ultracode/mode") return {
						...state,
						active: event.data.active,
						mode: event.data.mode,
						wanted: null
					};
					return state;
				},
				view: (state) => {
					const next = state.running?.target ?? state.wanted;
					return {
						active: state.active,
						mode: state.mode,
						pending: next !== null && (next.active !== state.active || next.mode !== state.mode)
					};
				},
				stateVersion: 1
			});
		});
		ctx.inject(["commands"], (commandCtx) => {
			commandCtx.commands.register({
				name: ULTRACODE_COMMAND,
				description: "Switch UltraCode deep-work policy on, off, or between cost modes",
				input: { hint: "[maximum|frugal|off]" },
				handler: ({ agent, rawInput }) => {
					const target = this.commandTarget(rawInput, this.fold(agent.session));
					if (target === void 0) return {
						kind: "error",
						text: `Unknown UltraCode mode "${rawInput.trim()}" — use /ultracode, /ultracode maximum, /ultracode frugal, or /ultracode off.`
					};
					switch (this.set(agent, target)) {
						case "noop": return {
							kind: "success",
							text: `UltraCode already runs ${target.active ? target.mode : "off"}.`
						};
						case "queued": return {
							kind: "success",
							text: `${describeTarget(target)} (applies from the next step.)`
						};
					}
				}
			});
		});
	}
	/**
	* The model-facing guidance for one session's current policy.
	*
	* The resolved routes are interpolated rather than described generically: the
	* model cannot otherwise know which model a delegation lands on, and the
	* policy differs by mode in exactly that respect.
	* @param state - the mode to render, including a selection not yet committed.
	* @returns the assembled section text.
	*/
	sectionText(state) {
		const routes = resolveRoleRoutes(state.mode, this.config.roles ?? {}, this.config.catalog.routes);
		const routesText = state.mode === "maximum" ? `Every role runs on ${routes.coder.model}.` : `Delegated coding runs on ${routes.coder.model}; validation and testing run on ${routes.validator.model}.`;
		return this.config.section.replaceAll("{mode}", state.mode).replaceAll("{routes}", routesText);
	}
	/** Fold one session's log against the deployment's configured fallback mode. */
	fold(session) {
		return foldUltraCode(session.events, void 0, this.fallback);
	}
	/**
	* Whether one agent's own loop is the top-level session UltraCode governs.
	*
	* A routed child carries `ultracodeRole`, so it is excluded: its rung comes
	* from its catalog route and must not be re-derived from the parent's mode.
	* @param agent - the agent whose request is being built.
	* @returns whether UltraCode policy governs this agent's own requests.
	*/
	isDeepWork(agent) {
		if (agent.options.ultracodeRole !== void 0) return false;
		return this.fold(agent.session).active;
	}
	/**
	* The effort the active mode selects for a session's own loop.
	*
	* `maximum` reasons at the effort its coder route declares, and `frugal`
	* leaves the orchestrator at the adapter default: the saving mode is defined
	* by not paying for the top rung, and planning is where that trade is most
	* defensible.
	* @param agent - the session owner whose request is being built.
	* @returns the catalog effort id, or `undefined` to keep the adapter default.
	*/
	ownEffort(agent) {
		if (this.fold(agent.session).mode !== "maximum") return void 0;
		return this.routesFor(agent.session).coder.effort;
	}
	/** Resolve the cheapest/best routes currently in force for one session. */
	routesFor(session) {
		return resolveRoleRoutes(this.fold(session).mode, this.config.roles ?? {}, this.config.catalog.routes);
	}
	/**
	* Read the UltraCode state in force for one session.
	* @param session - the session to fold.
	* @returns whether UltraCode is active and which cost mode is in force.
	*/
	modeOf(session) {
		return this.fold(session);
	}
	/** Resolve the route that reads images for a coder that cannot. */
	async visionRouteFor(session, signal) {
		const routes = this.routesFor(session);
		return resolveVisionRoute(this.ctx.llm, routes.vision, this.config.catalog.routes, signal);
	}
	/**
	* The `AgentOptions` overlay that runs a delegated child as one role.
	*
	* Only the provider and model are set: the child inherits the parent's
	* remaining options through the delegation seam, and the role stamp lets a
	* later step classify the child without re-reading policy.
	* @param session - the delegating session whose mode selects the route.
	* @param role - the role the child runs as.
	* @returns the overlay to pass as `agentOptions`.
	*/
	agentOptionsFor(session, role) {
		const routes = this.routesFor(session);
		const route = role === "coder" ? routes.coder : routes.validator;
		return {
			provider: route.provider,
			model: route.model,
			ultracodeRole: role,
			...route.effort === void 0 ? {} : { ultracodeEffort: route.effort }
		};
	}
	/**
	* Select a mode for the next accepted step.
	*
	* The selection is deferred rather than appended here: a command runs inside
	* an open turn, and the mode event is emitted from the pre-step boundary the
	* selection applies to.
	* @param agent - the session owner selecting the mode.
	* @param target - the mode to apply from the next accepted step.
	* @returns `noop` when the session already runs that mode, `queued` otherwise.
	*/
	set(agent, target) {
		const current = this.fold(agent.session);
		if (current.active === target.active && current.mode === target.mode) {
			this.pendingIntents.delete(agent.session);
			return "noop";
		}
		this.pendingIntents.set(agent.session, target);
		return "queued";
	}
	/**
	* Append the pending selection once the step is accepted.
	* @param session - the session whose step was accepted.
	* @param pending - the selection resolved from the map by the caller; passing
	* it in keeps the map lookup and its absence check in one place.
	*/
	commit(session, pending) {
		const current = this.fold(session);
		if (current.active !== pending.active || current.mode !== pending.mode) session.append("ultracode/mode", {
			active: pending.active,
			mode: pending.mode
		});
		this.pendingIntents.delete(session);
	}
	/**
	* Whether any human-typed message in this step names the activation keyword.
	*
	* Only a real user prompt counts: a plugin notice, a tool result, or a model
	* message that happens to contain the word must not switch the mode, or a
	* delegation could activate UltraCode on its own.
	* @param messages - the user messages claimed for this step.
	* @returns whether one of them carried the keyword.
	*/
	requestedByKeyword(messages) {
		const keyword = this.config.keyword;
		if (keyword === void 0) return false;
		const pattern = new RegExp(`\\b${keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
		return messages.some((message) => message.source.kind === "user" && message.content.some((block) => block.type === "text" && pattern.test(block.text)));
	}
	/**
	* The periodic restatement of the active policy, when this turn is due one.
	*
	* The cadence counts the session's own durable turn number, so the interval a
	* deployment configures is the interval it observes, and a resumed session
	* reaches the same schedule as one that never stopped without a counter to
	* persist. Only a turn's first step attaches it: a turn spanning several
	* steps would otherwise repeat the notice on each one.
	* @param session - the session the policy is read from.
	* @param turn - the durable turn this step belongs to.
	* @param step - the step within that turn.
	* @returns the notice to attach, or undefined when none is due.
	*/
	reminder(session, turn, step) {
		const every = this.config.reminderEveryTurns ?? 0;
		if (every <= 0 || step !== 1) return void 0;
		const state = this.fold(session);
		if (!state.active) return void 0;
		if (turn % every !== 0) return void 0;
		const text = `UltraCode is still on in ${state.mode} mode. Keep delegating substantive work with the ultracode_delegate tool rather than solving it solo.`;
		return createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: {
				kind: "plugin",
				plugin: "ultracode",
				form: "notice",
				summary: text
			}
		});
	}
	/** Build the user-switch notice for a mode change the model has not seen. */
	narration(session, target) {
		const told = this.fold(session);
		if (told.active === target.active && told.mode === target.mode) return void 0;
		const text = target.active ? `UltraCode is on in ${target.mode} mode.` : "UltraCode is off.";
		return createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: {
				kind: "plugin",
				plugin: "ultracode",
				form: "notice",
				summary: text
			}
		});
	}
	/** Resolve a `/ultracode` argument against the state it modifies. */
	commandTarget(raw, current) {
		const token = raw.trim().toLowerCase();
		if (token === "off") return {
			active: false,
			mode: current.mode
		};
		if (token === "") return {
			active: !current.active,
			mode: current.mode
		};
		const mode = parseMode(token);
		if (mode === void 0) return void 0;
		return {
			active: true,
			mode
		};
	}
};
//#endregion
export { Config, ULTRACODE_COMMAND, UltraCodeController, UltraCodeController as default, acceptsImages, foldUltraCode, needsVisionHandoff, readInputModalities, resolveConfig, resolveRoleRoutes, resolveRouteEffort, resolveVisionRoute };
