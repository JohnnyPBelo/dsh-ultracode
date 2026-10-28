import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import schemastery from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import * as dshSession from "@deepseek-ai/dsh-session";
//#region lib/compat.js
/**
* Version seams between the DeepSeek Harness lines UltraCode runs on.
*
* The plugin was first written against the 0.1.0-rc.8 API and is installed on
* 0.2.1-rc.3, whose session log, message sources, projection contract, and
* step preparation all changed shape. Every difference is feature-detected
* here, at the one place it is read, so both lines run the same code:
*
* - Durable records: 0.2.x refuses to resume a log that carries an unknown,
*   non-ignorable event type, and offers `appendPluginRecord` for ignorable
*   `plugin:<package>/<kind>` records instead. 0.1.x has no such call and
*   accepts plain `ultracode/<kind>` events. Readers accept both names.
* - Message sources: 0.2.x retired the shared `plugin` source kind; a producer
*   declares its own. `ultracode` is valid on both lines.
* - Session reads: 0.1.x exposes `session.events`; 0.2.x only the deprecated
*   `snapshotEvents()`, and prefers a projection handle's `stateOf`.
* - Reasoning effort: 0.2.x fixes the step's selection before `agent/request`
*   and rejects a rewrite, so a routed child carries its effort in
*   `AgentOptions.reasoningEffort`; 0.1.x keeps the request rewrite.
*
* @module dsh-ultracode/compat
*/
/** Record type prefix on lines that support ignorable plugin records. */
const RECORD_PREFIX = "plugin:dsh-ultracode/";
/** Plain event type prefix on lines without plugin records. */
const LEGACY_PREFIX = "ultracode/";
/** The producer-owned message source kind UltraCode notices carry. */
const SOURCE_KIND = "ultracode";
/** Bound of a `notice` summary (`CONTEXT_SUMMARY_MAX_CHARS` on 0.2.x). */
const SUMMARY_MAX_CHARS = 120;
/**
* Normalize one event's type to the `ultracode/<kind>` name, whichever line
* wrote it.
* @param event - any session event.
* @returns `ultracode/<kind>` for an UltraCode record, the type unchanged otherwise.
*/
function ultraEventType(event) {
	const type = event?.type;
	return typeof type === "string" && type.startsWith(RECORD_PREFIX) ? LEGACY_PREFIX + type.slice(RECORD_PREFIX.length) : type;
}
/**
* Append one UltraCode record: an ignorable plugin record where the session
* package offers one (so the log stays resumable without this plugin), a plain
* `ultracode/<kind>` event otherwise.
* @param session - the session whose log receives the record.
* @param kind - the record kind (`mode`, `task`, `member`, `outcome`, `task-end`, `vision-handoff`).
* @param data - JSON payload.
* @returns whatever the underlying append returned.
*/
function appendUltraRecord(session, kind, data) {
	if (typeof dshSession.appendPluginRecord === "function") return dshSession.appendPluginRecord(session, RECORD_PREFIX + kind, data);
	return session.append(LEGACY_PREFIX + kind, data);
}
/**
* Read a session's committed events on either line.
* @param session - the session to read.
* @returns the events in log order.
*/
function sessionEvents(session) {
	const events = session.events;
	if (events !== void 0) return events;
	if (typeof session.snapshotEvents === "function") return session.snapshotEvents();
	return [];
}
/**
* Bound one notice summary to the one-line account the log records.
* @param text - the summary text.
* @returns the text, ellipsized past the bound.
*/
function boundSummary(text) {
	return text.length <= SUMMARY_MAX_CHARS ? text : `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}
/**
* Build one UltraCode-attributed user-role message.
* @param text - the model-facing text.
* @param summary - the one-line account shown without expanding the row.
* @returns the message.
*/
function ultraNotice(text, summary = text) {
	return createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: {
			kind: SOURCE_KIND,
			form: "notice",
			summary: boundSummary(summary)
		}
	});
}
/**
* Whether this line fixes the model selection before `agent/request` (0.2.x),
* so effort must travel in the child's `AgentOptions` instead of a request rewrite.
* @param agent - any live agent.
* @returns whether the agent exposes `model.select`.
*/
function selectsModelPerStep(agent) {
	return typeof agent?.model?.select === "function";
}
/**
* Whether an agent is a child UltraCode itself routed (it carries the role stamp).
* @param agent - any agent.
* @returns whether the agent runs as an UltraCode role.
*/
function isRoutedChild(agent) {
	return agent?.options?.ultracodeRole !== void 0;
}
/**
* The route the session's own next step runs on: the recorded selection on
* 0.2.x, the logged request header or the agent options otherwise.
* @param agent - the session owner.
* @returns the provider/model (and effort, when one is selected), or undefined when unknown.
*/
function sessionRoute(agent) {
	if (agent === void 0) return void 0;
	const pick = (provider, model, effort) => typeof provider === "string" && provider !== "" && typeof model === "string" && model !== "" ? {
		provider,
		model,
		...typeof effort === "string" && effort !== "" ? { effort } : {}
	} : void 0;
	if (typeof agent.model?.current === "function") {
		const current = agent.model.current();
		const route = pick(current?.provider, current?.model, current?.reasoningEffort);
		if (route !== void 0) return route;
	}
	if (typeof agent.session?.requestHeader === "function") {
		const config = agent.session.requestHeader()?.config;
		const route = pick(config?.provider, config?.model, config?.reasoningEffort);
		if (route !== void 0) return route;
	}
	return pick(agent.options?.provider, agent.options?.model, agent.options?.reasoningEffort);
}
/** Effort ids in ascending order of reasoning, for ladders the adapter does not order. */
const EFFORT_ORDER = [
	"none",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* Pick the highest (`top`) or the lowest still-reasoning (`bottom`) rung of a
* model's declared effort ladder.
* @param efforts - the adapter-declared effort ids.
* @param rung - which end of the ladder to take.
* @returns the chosen id, or undefined for an empty ladder.
*/
function pickRung(efforts, rung) {
	if (efforts.length === 0) return void 0;
	const rank = (id) => EFFORT_ORDER.indexOf(id.toLowerCase());
	const known = efforts.filter((id) => rank(id) >= 0);
	if (rung === "top") {
		if (known.length === 0) return efforts[efforts.length - 1];
		return known.reduce((best, id) => rank(id) > rank(best) ? id : best);
	}
	const reasoning = known.filter((id) => rank(id) > rank("off"));
	if (reasoning.length > 0) return reasoning.reduce((low, id) => rank(id) < rank(low) ? id : low);
	return efforts.find((id) => rank(id) < 0) ?? efforts[0];
}
/** Error code of a thrown value, when it carries one. */
function errorCode(error) {
	return typeof error === "object" && error !== null && typeof error.code === "string" ? error.code : void 0;
}
/** Message of a thrown value. */
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
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
* can pin one role's model without disturbing the mode's other choices. An
* empty catalog resolves every unpinned role to `undefined`: the child then
* inherits its parent's route.
* @param mode - the active cost mode.
* @param roles - deployment-pinned per-role routes, if any.
* @param catalog - the deployment's ordered routes, best first.
* @returns the resolved route per role.
*/
function resolveRoleRoutes(mode, roles, catalog) {
	const tier = (role) => catalog.length === 0 ? void 0 : tierRoute(mode, role, catalog);
	return {
		coder: roles.coder ?? tier("coder"),
		validator: roles.validator ?? tier("validator"),
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
* A route derived from the session's own model (no catalog configured) names a
* rung instead of an id — `top` or `bottom` of that model's ladder.
*
* @module @deepseek-ai/dsh-ultracode/effort
*/
/**
* Resolve the effort a route actually runs at on its own model.
*
* Both an absent catalog effort and a model that does not expose it resolve to
* `undefined`, which leaves the adapter's configured default in force.
* @param llm - the LLM service resolving model metadata.
* @param route - the provider/model route and the effort (or rung) the catalog named.
* @param signal - optional cancellation for adapter-owned lookup.
* @returns the validated effort id, or `undefined` when the model does not expose it.
*/
async function resolveRouteEffort(llm, route, signal) {
	if (route.effort === void 0 && route.rung === void 0) return void 0;
	let info;
	try {
		info = await llm.resolveModelInfo(route.provider, route.model, signal);
	} catch {
		return;
	}
	const efforts = (info.reasoning?.efforts ?? []).map((effort) => effort.id);
	if (route.effort !== void 0) return efforts.find((id) => id === route.effort);
	return pickRung(efforts, route.rung);
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
* The state in force is folded from the session log (the `mode` record, last
* one wins), so resume and fork restore it without a live mirror. User
* selections remain pending until the next accepted in-turn pre-step.
*
* Routing is enforced where the decision is made, not where it is described:
* a child that the policy routes runs on the resolved role route through
* `AgentOptions`, while the session's own route is never rewritten — the parent
* keeps the model the user selected. Without a configured catalog every role
* runs on the session's own model.
*
* @module @deepseek-ai/dsh-ultracode
*/
/** The command that switches UltraCode on, off, or between modes. */
const ULTRACODE_COMMAND = "ultracode";
/** The guidance the model reads while the mode is on, when the deployment names none. */
const DEFAULT_SECTION = [
	"UltraCode is on in {mode} mode: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Decompose every substantive task, delegate the parts in parallel, and verify the assembled result before reporting it. {routes} Conversation and trivial turns stay solo.",
	"",
	"Delegate with the ultracode_delegate tool, not the plain subagent tool: only that tool applies the mode's routing, and in frugal mode it also runs the validator loop until the code passes. Give every child a self-contained prompt; it does not see this conversation.",
	"",
	"When a delegated model cannot read images, the handoff describes them through an image-capable model first, so send the images you have rather than working around them."
].join("\n");
const MODE_SCHEMA = z.union([z.literal("maximum"), z.literal("frugal")]);
/** Validates the wire payload this unit's `view` produces. */
const VIEW_SCHEMA = z.object({
	active: z.boolean(),
	mode: MODE_SCHEMA,
	pending: z.boolean()
});
const TARGET_SCHEMA = z.object({
	active: z.boolean(),
	mode: MODE_SCHEMA
});
/** Validates the projection's persisted state (0.2.x checkpoint rows). */
const STATE_SCHEMA = z.object({
	active: z.boolean(),
	mode: MODE_SCHEMA,
	wanted: TARGET_SCHEMA.nullable(),
	running: z.object({
		commandId: z.string(),
		target: TARGET_SCHEMA
	}).nullable()
});
const ROUTE_SCHEMA = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
	effort: z.string().min(1).optional()
});
/**
* Config schema for the Loader. Every key is optional: a profile patch replaces
* the row's whole config, so an override that names only `catalog` still loads
* with the default guidance.
*/
const S = schemastery;
const Config = S.object({
	section: S.string().volatile(),
	catalog: S.object({ routes: S.array(S.object({
		provider: S.string().min(1),
		model: S.string().min(1),
		effort: S.string().min(1)
	})) }).volatile(),
	roles: S.object({
		coder: S.object({
			provider: S.string().min(1),
			model: S.string().min(1),
			effort: S.string().min(1)
		}),
		validator: S.object({
			provider: S.string().min(1),
			model: S.string().min(1),
			effort: S.string().min(1)
		}),
		vision: S.object({
			provider: S.string().min(1),
			model: S.string().min(1),
			effort: S.string().min(1)
		})
	}).volatile(),
	mode: S.union(["maximum", "frugal"]).volatile(),
	keyword: S.string().min(1).volatile(),
	reminderEveryTurns: S.natural().max(1024).volatile()
}).default({});
/**
* Fold UltraCode state from the session log. The last `mode` record wins; a
* prefix with none is inactive in `fallback.mode`.
*
* The fallback is the deployment's configured mode: a session that has never
* committed one still reads that mode, which is what the projection reports and
* what `/ultracode` would turn on. Folding to `maximum` regardless would make a
* pre-configured `frugal` deployment route on one tier and display another.
* @param events - the session log or any prefix of it.
* @param end - fold `events[0, end)`; defaults to the whole log.
* @param fallback - the state a prefix with no `mode` record reads.
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
		if (ultraEventType(event) === "ultracode/mode") state = {
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
* Unwrap one config field the loader may hand over as a live reference.
*
* A schemastery `volatile` field resolves to a reference object with `get()`,
* not a plain value, so the running edit applies without a restart. An ordinary
* field is already a value and passes through unchanged. Both lines deliver one
* or the other, so every read goes through here.
* @param field - the config field as the loader delivered it.
* @returns the current value of that field.
*/
function configValue(field) {
	return field !== null && typeof field === "object" && typeof field.get === "function" ? field.get() : field;
}
/**
* Detach one route, or nothing when the entry names no provider and model.
*
* A schemastery volatile object resolves absent nested members to empty route
* objects rather than `undefined`, so a config that names only `catalog` still
* carries `roles: { coder: {}, validator: {}, vision: {} }`. A route without
* both a provider and a model is not a selection.
* @param route - a configured or empty route.
* @returns the detached route, or `undefined` when the entry selects nothing.
*/
function detachRoute(route) {
	if (route === null || typeof route !== "object") return void 0;
	if (typeof route.provider !== "string" || route.provider === "") return void 0;
	if (typeof route.model !== "string" || route.model === "") return void 0;
	return {
		provider: route.provider,
		model: route.model,
		...route.effort === void 0 ? {} : { effort: route.effort }
	};
}
/**
* Validate deployment config at load rather than at first use.
* @param config - raw plugin config.
* @returns a detached validated config.
*/
function resolveConfig(config = {}) {
	const section = configValue(config.section) ?? DEFAULT_SECTION;
	if (typeof section !== "string" || section.trim() === "") throw new Error("UltraCodeConfig `section` must be a non-empty string when set");
	const catalog = configValue(config.catalog);
	const routes = catalog?.routes ?? [];
	const roles = configValue(config.roles);
	const mode = configValue(config.mode);
	const keyword = configValue(config.keyword);
	const reminderEveryTurns = configValue(config.reminderEveryTurns);
	const resolvedRoles = {};
	for (const [role, route] of Object.entries(roles ?? {})) {
		const detached = detachRoute(configValue(route));
		if (detached !== void 0) resolvedRoles[role] = detached;
	}
	return {
		section,
		catalog: { routes: routes.flatMap((route) => {
			const detached = detachRoute(configValue(route));
			return detached === void 0 ? [] : [detached];
		}) },
		...Object.keys(resolvedRoles).length === 0 ? {} : { roles: resolvedRoles },
		...mode === void 0 ? {} : { mode },
		...keyword === void 0 ? {} : { keyword },
		...reminderEveryTurns === void 0 ? {} : { reminderEveryTurns }
	};
}
/** How long one route preflight result is reused. */
const PREFLIGHT_TTL_MS = 6e4;
/**
* UltraCode's session policy and model-routing service.
*
* The service exposes routing so other plugins (a delegation tool, an
* orchestration UI) ask UltraCode which route a role should run on instead of
* duplicating tier logic.
*/
var UltraCodeController = class extends Service {
	static inject = ["llm", "systemPrompt"];
	static Config = Config;
	pendingIntents = /* @__PURE__ */ new WeakMap();
	/** The awaited projection handle on lines whose registry returns one. */
	projection;
	/** Route preflight results, keyed by provider and model. */
	preflights = /* @__PURE__ */ new Map();
	/** The state a session that never committed a mode reads. */
	fallback = {
		active: false,
		mode: "maximum"
	};
	/**
	* The configuration in force for this read.
	*
	* A volatile member arrives as a live reference, so unwrapping on every read is
	* what makes a saved settings edit apply to the next delegation rather than the
	* next process.
	* @returns the resolved configuration.
	*/
	get config() {
		const raw = this.rawConfig;
		return resolveConfig({
			section: configValue(raw.section),
			catalog: configValue(raw.catalog),
			roles: configValue(raw.roles),
			mode: configValue(raw.mode),
			keyword: configValue(raw.keyword),
			reminderEveryTurns: configValue(raw.reminderEveryTurns)
		});
	}

	/**
	* The config object exactly as the loader delivered it. Volatile members stay
	* live references, so a saved edit reaches the next read without a restart.
	*/
	rawConfig;
	constructor(ctx, config) {
		super(ctx, "ultracode");
		this.rawConfig = config;
		this.fallback = {
			active: false,
			mode: this.config.mode ?? "maximum"
		};
		ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
			const decision = await next();
			if (decision.kind === "reject" || signal.aborted) return decision;
			if (agent === void 0 || isRoutedChild(agent)) return decision;
			const byKeyword = this.requestedByKeyword(messages);
			if (byKeyword) this.pendingIntents.set(agent.session, {
				active: true,
				mode: this.fold(agent.session).mode
			});
			const pending = this.pendingIntents.get(agent.session);
			if (pending !== void 0) {
				const narration = this.narration(agent, pending, byKeyword);
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
				if (context.agent === void 0 || isRoutedChild(context.agent)) return "";
				const state = this.pendingIntents.get(context.agent.session) ?? this.fold(context.agent.session);
				return state.active ? this.sectionText(state, context.agent) : "";
			}
		});
		ctx.on("agent/request", async ({ agent, signal }, next) => {
			const resolved = await next();
			if (agent === void 0 || selectsModelPerStep(agent)) return resolved;
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
		ctx.inject(["sessionProjections"], async (projectionCtx) => {
			const registered = projectionCtx.sessionProjections.register(this.projectionDefinition());
			const handle = registered !== null && registered !== void 0 && typeof registered.then === "function" ? await registered : registered;
			if (handle === null || handle === void 0 || typeof handle.stateOf !== "function") return;
			this.projection = handle;
			projectionCtx.effect(() => () => {
				if (this.projection === handle) this.projection = void 0;
			}, "ultracode: projection handle");
		});
		ctx.inject(["commands"], (commandCtx) => {
			commandCtx.commands.register({
				name: ULTRACODE_COMMAND,
				description: "Switch UltraCode deep-work policy on, off, or between cost modes",
				input: { hint: "[maximum|frugal|off]" },
				handler: ({ agent, rawInput }) => {
					const target = this.commandTarget(rawInput ?? "", this.fold(agent.session));
					if (target === void 0) return {
						kind: "error",
						text: `Unknown UltraCode mode "${(rawInput ?? "").trim()}" — use /ultracode, /ultracode maximum, /ultracode frugal, or /ultracode off.`
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
	* The `ultracode` projection unit: the mode in force plus a selection still
	* waiting for its step. Both registry contracts are declared side by side —
	* `stateSchema` and `wire` (0.2.x), `schema` and `view` (0.1.x).
	* @returns the projection definition.
	*/
	projectionDefinition() {
		const view = (state) => {
			const next = state.running?.target ?? state.wanted;
			return {
				active: state.active,
				mode: state.mode,
				pending: next !== null && (next.active !== state.active || next.mode !== state.mode)
			};
		};
		return {
			key: "ultracode",
			schema: VIEW_SCHEMA,
			stateSchema: STATE_SCHEMA,
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
				if (ultraEventType(event) === "ultracode/mode") return {
					...state,
					active: event.data.active,
					mode: event.data.mode,
					wanted: null
				};
				return state;
			},
			view,
			wire: {
				viewSchema: VIEW_SCHEMA,
				view
			},
			stateVersion: 1
		};
	}
	/**
	* The model-facing guidance for one session's current policy.
	*
	* The resolved routes are interpolated rather than described generically: the
	* model cannot otherwise know which model a delegation lands on, and the
	* policy differs by mode in exactly that respect.
	* @param state - the mode to render, including a selection not yet committed.
	* @param agent - the session owner, whose own model serves when no catalog is configured.
	* @returns the assembled section text.
	*/
	sectionText(state, agent) {
		const routes = this.resolveRoutes(state.mode, agent);
		const label = (route) => {
			if (route === void 0) return "the session's own model";
			if (route.rung === "top") return `${route.model} at its highest reasoning effort`;
			if (route.rung === "bottom") return `${route.model} at its lowest reasoning effort`;
			return route.model;
		};
		const routesText = state.mode === "maximum" ? `Every role runs on ${label(routes.coder)}.` : `Delegated coding runs on ${label(routes.coder)}; validation and testing run on ${label(routes.validator)}.`;
		return this.config.section.replaceAll("{mode}", state.mode).replaceAll("{routes}", routesText);
	}
	/** Fold one session's log against the deployment's configured fallback mode. */
	fold(session) {
		const handle = this.projection;
		if (handle !== void 0) try {
			const state = handle.stateOf(session);
			if (state !== void 0 && state !== null) return {
				active: state.active,
				mode: state.mode
			};
		} catch {}
		return foldUltraCode(sessionEvents(session), void 0, this.fallback);
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
		if (isRoutedChild(agent)) return false;
		return this.fold(agent.session).active;
	}
	/**
	* The effort the active mode selects for a session's own loop (0.1.x only;
	* on 0.2.x the session's own effort stays the one the user selected).
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
		return this.routesFor(agent).coder?.effort;
	}
	/**
	* The ordered routes tier selection reads: the configured catalog, or —
	* when none is configured — the session's own model, best rung first.
	* @param agent - the session owner, when known.
	* @returns the catalog, possibly empty.
	*/
	catalogFor(agent) {
		const routes = this.config.catalog.routes;
		if (routes.length > 0) return routes;
		const own = isRoutedChild(agent) ? void 0 : sessionRoute(agent);
		if (own === void 0) return [];
		return [{
			provider: own.provider,
			model: own.model,
			rung: "top"
		}, {
			provider: own.provider,
			model: own.model,
			rung: "bottom"
		}];
	}
	/** Resolve every role for one mode against the session owner's catalog. */
	resolveRoutes(mode, agent) {
		return resolveRoleRoutes(mode, this.config.roles ?? {}, this.catalogFor(agent));
	}
	/**
	* Resolve the routes currently in force for one session.
	* @param target - the session owner (preferred) or the session itself.
	* @returns the route per role; an unpinned role is undefined without a catalog or a known session route.
	*/
	routesFor(target) {
		const agent = target?.session !== void 0 ? target : void 0;
		const session = agent?.session ?? target;
		return this.resolveRoutes(this.fold(session).mode, agent);
	}
	/**
	* Read the UltraCode state in force for one session.
	* @param session - the session to fold.
	* @returns whether UltraCode is active and which cost mode is in force.
	*/
	modeOf(session) {
		return this.fold(session);
	}
	/**
	* Resolve the route that reads images for a coder that cannot.
	* @param target - the delegating agent (preferred) or its session.
	* @param signal - cancellation for adapter-owned lookup.
	* @returns the vision route, or why none is available.
	*/
	async visionRouteFor(target, signal) {
		const agent = target?.session !== void 0 ? target : void 0;
		const routes = this.routesFor(target);
		const configured = this.config.catalog.routes;
		const own = sessionRoute(agent);
		const candidates = configured.length > 0 ? configured : own === void 0 ? [] : [own];
		return resolveVisionRoute(this.ctx.llm, routes.vision, candidates, signal);
	}
	/**
	* The synchronous `AgentOptions` overlay that runs a delegated child as one
	* role. It names the route only; the delegation tool uses
	* {@link UltraCodeController.childOptionsFor}, which also validates the
	* effort and falls back from an unusable route.
	* @param target - the delegating agent (preferred) or its session.
	* @param role - the role the child runs as.
	* @returns the overlay to pass as `agentOptions`.
	*/
	agentOptionsFor(target, role) {
		const routes = this.routesFor(target);
		const route = role === "coder" ? routes.coder : routes.validator;
		return {
			...route === void 0 ? {} : {
				provider: route.provider,
				model: route.model
			},
			ultracodeRole: role,
			...route?.effort === void 0 ? {} : { ultracodeEffort: route.effort }
		};
	}
	/**
	* Resolve the options one delegated child runs with: the role's route,
	* preflighted so a route whose provider is absent or unauthenticated falls
	* back to the session's own route (with a note the caller reports), and an
	* effort validated against that model's ladder.
	* @param agent - the delegating session owner.
	* @param role - the role the child runs as.
	* @param signal - cancellation for adapter-owned lookup.
	* @returns the overlay, the route it names (the session's own when inherited), and any fallback notes.
	*/
	async childOptionsFor(agent, role, signal) {
		const routes = this.routesFor(agent);
		const own = sessionRoute(agent);
		let route = role === "coder" ? routes.coder : routes.validator;
		const notes = [];
		if (route !== void 0) {
			const problem = await this.routeProblem(route, own, signal);
			if (problem !== void 0) {
				if (own === void 0) throw new Error(`UltraCode cannot run the ${role} on ${route.provider}/${route.model}: ${problem}. Fix the ultracode catalog or configure that provider.`);
				const note = `UltraCode route ${route.provider}/${route.model} is unavailable (${problem}); the ${role} ran on the session's route ${own.provider}/${own.model} instead.`;
				notes.push(note);
				this.ctx.logger.warn("dsh-ultracode: %s", note);
				route = {
					...route,
					provider: own.provider,
					model: own.model
				};
			}
		}
		const effort = route === void 0 ? void 0 : await resolveRouteEffort(this.ctx.llm, route, signal);
		const options = {
			...route === void 0 ? {} : {
				provider: route.provider,
				model: route.model
			},
			ultracodeRole: role,
			...effort === void 0 ? {} : selectsModelPerStep(agent) ? { reasoningEffort: effort } : { ultracodeEffort: effort }
		};
		const named = route ?? own;
		return {
			options,
			route: named === void 0 ? void 0 : {
				provider: named.provider,
				model: named.model,
				...effort === void 0 ? {} : { effort }
			},
			notes
		};
	}
	/**
	* Why a route cannot serve a child, or undefined when it can (or cannot be
	* proven not to). The session's own route is known good. Any other route
	* must name a registered provider and a model it resolves; a provider that
	* lists no models has no usable credential on the shipped adapters.
	* @param route - the route to check.
	* @param own - the session's own route.
	* @param signal - cancellation for adapter-owned lookup.
	* @returns the problem, or undefined.
	*/
	async routeProblem(route, own, signal) {
		if (own !== void 0 && route.provider === own.provider && route.model === own.model) return void 0;
		const key = `${route.provider}\u0000${route.model}`;
		const cached = this.preflights.get(key);
		if (cached !== void 0 && Date.now() - cached.at < PREFLIGHT_TTL_MS) return cached.problem;
		const llm = this.ctx.llm;
		let problem;
		try {
			const providers = typeof llm.listProviders === "function" ? llm.listProviders() : void 0;
			if (Array.isArray(providers) && !providers.some((entry) => (entry?.id ?? entry) === route.provider)) problem = `provider "${route.provider}" is not registered`;
			else {
				await llm.resolveModelInfo(route.provider, route.model, signal);
				if (typeof llm.listModels === "function") try {
					const models = await llm.listModels(route.provider);
					if (Array.isArray(models) && models.length === 0) problem = `provider "${route.provider}" offers no models, which usually means its API key is not configured`;
				} catch (error) {
					if (errorCode(error) === "MISSING_CREDENTIAL") problem = errorMessage(error);
				}
			}
		} catch (error) {
			signal?.throwIfAborted();
			problem = errorMessage(error);
		}
		signal?.throwIfAborted();
		this.preflights.set(key, {
			at: Date.now(),
			problem
		});
		return problem;
	}
	/**
	* Select a mode for the next accepted step.
	*
	* The selection is deferred rather than appended here: a command runs inside
	* an open turn, and the mode record is emitted from the pre-step boundary the
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
		if (current.active !== pending.active || current.mode !== pending.mode) appendUltraRecord(session, "mode", {
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
		if (keyword === void 0 || !Array.isArray(messages)) return false;
		const pattern = new RegExp(`\\b${keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
		return messages.some((message) => message?.source?.kind === "user" && Array.isArray(message.content) && message.content.some((block) => block.type === "text" && pattern.test(block.text)));
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
		return ultraNotice(`UltraCode is still on in ${state.mode} mode. Keep delegating substantive work with the ultracode_delegate tool rather than solving it solo.`, `UltraCode is still on in ${state.mode} mode.`);
	}
	/**
	* Build the user-switch notice for a mode change the model has not seen.
	*
	* The system prompt is assembled before the pre-step boundary, so a step the
	* keyword switched on carries no policy section yet; that notice carries the
	* policy text itself.
	* @param agent - the session owner.
	* @param target - the selection being committed.
	* @param withPolicy - whether to include the guidance the system prompt lacks this step.
	* @returns the notice, or undefined when the model already reads this state.
	*/
	narration(agent, target, withPolicy = false) {
		const told = this.fold(agent.session);
		if (told.active === target.active && told.mode === target.mode) return void 0;
		const summary = target.active ? `UltraCode is on in ${target.mode} mode.` : "UltraCode is off.";
		const text = withPolicy && target.active ? `${summary}\n\n${this.sectionText(target, agent)}` : summary;
		return ultraNotice(text, summary);
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
export { Config, DEFAULT_SECTION, RECORD_PREFIX, SOURCE_KIND, ULTRACODE_COMMAND, UltraCodeController, UltraCodeController as default, acceptsImages, appendUltraRecord, boundSummary, foldUltraCode, isRoutedChild, needsVisionHandoff, pickRung, readInputModalities, resolveConfig, resolveRoleRoutes, resolveRouteEffort, resolveVisionRoute, selectsModelPerStep, sessionEvents, sessionRoute, ultraEventType, ultraNotice };
