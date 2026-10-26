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
import { Service } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { resolveRoleRoutes } from "./routing.js";
import { resolveRouteEffort } from "./effort.js";
import { resolveVisionRoute } from "./vision.js";
export { resolveRoleRoutes, needsVisionHandoff } from "./routing.js";
export { resolveRouteEffort } from "./effort.js";
export { acceptsImages, readInputModalities, resolveVisionRoute } from "./vision.js";
/** The command that switches UltraCode on, off, or between modes. */
export const ULTRACODE_COMMAND = 'ultracode';
/** Validates the wire payload this unit's `view` produces. */
const VIEW_SCHEMA = z.object({
    active: z.boolean(),
    mode: z.union([z.literal('maximum'), z.literal('frugal')]),
    pending: z.boolean(),
});
/** Config schema for the Loader. */
export const Config = z.object({
    section: z.string(),
    catalog: z.object({
        routes: z.array(z.object({
            provider: z.string().min(1),
            model: z.string().min(1),
            effort: z.string().min(1).optional(),
        })).min(1),
    }),
    roles: z.object({
        coder: z.object({
            provider: z.string().min(1),
            model: z.string().min(1),
            effort: z.string().min(1).optional(),
        }).optional(),
        validator: z.object({
            provider: z.string().min(1),
            model: z.string().min(1),
            effort: z.string().min(1).optional(),
        }).optional(),
        vision: z.object({
            provider: z.string().min(1),
            model: z.string().min(1),
            effort: z.string().min(1).optional(),
        }).optional(),
    }).optional(),
    mode: z.union([z.literal('maximum'), z.literal('frugal')]).optional(),
    keyword: z.string().min(1).optional(),
    reminderEveryTurns: z.number().int().min(0).max(1024).optional(),
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
export function foldUltraCode(events, end = events.length, fallback = { active: false, mode: 'maximum' }) {
    let state = fallback;
    let index = 0;
    for (const event of events) {
        if (index >= end)
            break;
        index++;
        if (event.type === 'ultracode/mode')
            state = { active: event.data.active, mode: event.data.mode };
    }
    return state;
}
/** Parse a mode word from command input. */
function parseMode(raw) {
    const token = raw.trim().toLowerCase();
    if (token === 'maximum' || token === 'max')
        return 'maximum';
    if (token === 'frugal' || token === 'save')
        return 'frugal';
    return undefined;
}
/** The user-facing description of one selected state. */
function describeTarget(target) {
    return target.active ? `UltraCode on (${target.mode})` : 'UltraCode off';
}
/**
 * Validate deployment config at load rather than at first use.
 * @param config - raw plugin config.
 * @returns a detached validated config.
 */
export function resolveConfig(config) {
    if (typeof config.section !== 'string' || config.section.trim() === '') {
        throw new Error('UltraCodeConfig needs a non-empty string `section`');
    }
    const routes = config.catalog.routes;
    if (routes.length === 0) {
        throw new Error('UltraCodeConfig needs `catalog.routes` with at least one provider/model route — UltraCode never invents a model order');
    }
    return {
        section: config.section,
        catalog: {
            routes: routes.map(route => ({
                provider: route.provider,
                model: route.model,
                ...route.effort === undefined ? {} : { effort: route.effort },
            })),
        },
        ...config.roles === undefined ? {} : { roles: config.roles },
        ...config.mode === undefined ? {} : { mode: config.mode },
        ...config.keyword === undefined ? {} : { keyword: config.keyword },
        ...config.reminderEveryTurns === undefined ? {} : { reminderEveryTurns: config.reminderEveryTurns },
    };
}
/**
 * UltraCode's session policy and model-routing service.
 *
 * The service exposes routing so other plugins (a delegation tool, an
 * orchestration UI) ask UltraCode which route a role should run on instead of
 * duplicating tier logic.
 */
export class UltraCodeController extends Service {
    static inject = ['llm', 'systemPrompt'];
    config;
    pendingIntents = new WeakMap();
    /** The state a session that never committed a mode reads. */
    fallback = { active: false, mode: 'maximum' };
    constructor(ctx, config) {
        super(ctx, 'ultracode');
        this.config = resolveConfig(config);
        this.fallback = { active: false, mode: this.config.mode ?? 'maximum' };
        ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next) => {
            const decision = await next();
            if (decision.kind === 'reject' || signal.aborted)
                return decision;
            // A human-typed prompt that names the keyword opts the session in, the
            // same switch the `/ultracode` command flips. Recording it as an intent
            // keeps one commit path: the keyword and the command both become a
            // logged `ultracode/mode` at the next accepted step.
            if (this.requestedByKeyword(messages)) {
                this.pendingIntents.set(agent.session, { active: true, mode: this.fold(agent.session).mode });
            }
            const pending = this.pendingIntents.get(agent.session);
            if (pending !== undefined) {
                const narration = this.narration(agent.session, pending);
                try {
                    this.commit(agent.session, pending);
                }
                catch (error) {
                    ctx.logger.warn('dsh-ultracode: failed to append selected mode at step start: %o', error);
                    return decision;
                }
                return narration === undefined ? decision : { ...decision, messages: [...decision.messages, narration] };
            }
            // A mode switch narrates itself above; a steady session still needs the
            // policy restated periodically, or a long run drifts back to cheap
            // single-agent habits once the original prompt leaves the window.
            const reminder = this.reminder(agent.session, turn, step);
            return reminder === undefined ? decision : { ...decision, messages: [...decision.messages, reminder] };
        });
        ctx.systemPrompt.section({
            name: 'ultracode:policy',
            order: 51,
            text: (context) => {
                if (context.agent === undefined)
                    return '';
                const pending = this.pendingIntents.get(context.agent.session);
                const state = pending ?? this.fold(context.agent.session);
                return state.active ? this.sectionText(state) : '';
            },
        });
        // The effort a catalog route names is a request control, not an agent
        // option: the loop builds its call from the agent's route and the adapter
        // default, so the rung must be stamped at the boundary that produces it.
        // A listener rather than an option keeps one enforcement point, and it is
        // global because the routed children are created after this plugin loads.
        //
        // Two sources select a rung, in precedence order: a routed child's own
        // catalog effort, and — for the session's own loop while UltraCode is
        // active — the coder route's effort. The second is what makes `maximum`
        // mean the same thing for the orchestrator as for the work it delegates:
        // without it the parent plans at the adapter default while its children
        // reason at the top rung.
        ctx.on('agent/request', async ({ agent, signal }, next) => {
            const resolved = await next();
            const routed = agent.options.ultracodeEffort;
            const own = routed === undefined && this.isDeepWork(agent) ? this.ownEffort(agent) : undefined;
            const wanted = routed ?? own;
            if (wanted === undefined)
                return resolved;
            const effort = await resolveRouteEffort(ctx.llm, { provider: resolved.provider, model: resolved.model, effort: wanted }, signal);
            return effort === undefined ? resolved : { ...resolved, reasoningEffort: effort };
        }, { global: true });
        ctx.inject(['sessionProjections'], (projectionCtx) => {
            projectionCtx.sessionProjections.register({
                key: 'ultracode',
                schema: VIEW_SCHEMA,
                init: () => ({
                    active: false,
                    mode: this.config.mode ?? 'maximum',
                    wanted: null,
                    running: null,
                }),
                apply: (state, event) => {
                    if (event.type === 'command/run' && event.data.name === ULTRACODE_COMMAND) {
                        const raw = event.data.args;
                        // A command record with no input carries no selection: a bare
                        // `/ultracode` is recorded as an empty string, so an absent `args`
                        // is a different lifecycle, not a toggle.
                        if (raw === undefined)
                            return state;
                        const target = this.commandTarget(raw, { active: state.active, mode: state.mode });
                        return target === undefined ? state : { ...state, running: { commandId: event.data.commandId, target } };
                    }
                    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
                        const wanted = event.data.kind === 'success' ? state.running.target : null;
                        return { ...state, wanted, running: null };
                    }
                    if (event.type === 'ultracode/mode') {
                        return { ...state, active: event.data.active, mode: event.data.mode, wanted: null };
                    }
                    return state;
                },
                view: (state) => {
                    const next = state.running?.target ?? state.wanted;
                    return {
                        active: state.active,
                        mode: state.mode,
                        pending: next !== null && (next.active !== state.active || next.mode !== state.mode),
                    };
                },
                stateVersion: 1,
            });
        });
        ctx.inject(['commands'], (commandCtx) => {
            commandCtx.commands.register({
                name: ULTRACODE_COMMAND,
                description: 'Switch UltraCode deep-work policy on, off, or between cost modes',
                input: { hint: '[maximum|frugal|off]' },
                handler: ({ agent, rawInput }) => {
                    const target = this.commandTarget(rawInput, this.fold(agent.session));
                    if (target === undefined) {
                        return {
                            kind: 'error',
                            text: `Unknown UltraCode mode "${rawInput.trim()}" — use /ultracode, /ultracode maximum, /ultracode frugal, or /ultracode off.`,
                        };
                    }
                    switch (this.set(agent, target)) {
                        case 'noop':
                            return { kind: 'success', text: `UltraCode already runs ${target.active ? target.mode : 'off'}.` };
                        case 'queued':
                            return { kind: 'success', text: `${describeTarget(target)} (applies from the next step.)` };
                    }
                },
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
        const routesText = state.mode === 'maximum'
            ? `Every role runs on ${routes.coder.model}.`
            : `Delegated coding runs on ${routes.coder.model}; validation and testing run on ${routes.validator.model}.`;
        return this.config.section
            .replaceAll('{mode}', state.mode)
            .replaceAll('{routes}', routesText);
    }
    /** Fold one session's log against the deployment's configured fallback mode. */
    fold(session) {
        return foldUltraCode(session.events, undefined, this.fallback);
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
        if (agent.options.ultracodeRole !== undefined)
            return false;
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
        const state = this.fold(agent.session);
        if (state.mode !== 'maximum')
            return undefined;
        return this.routesFor(agent.session).coder.effort;
    }
    /** Resolve the cheapest/best routes currently in force for one session. */
    routesFor(session) {
        const state = this.fold(session);
        return resolveRoleRoutes(state.mode, this.config.roles ?? {}, this.config.catalog.routes);
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
        const route = role === 'coder' ? routes.coder : routes.validator;
        return {
            provider: route.provider,
            model: route.model,
            ultracodeRole: role,
            ...route.effort === undefined ? {} : { ultracodeEffort: route.effort },
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
            return 'noop';
        }
        this.pendingIntents.set(agent.session, target);
        return 'queued';
    }
    /**
     * Append the pending selection once the step is accepted.
     * @param session - the session whose step was accepted.
     * @param pending - the selection resolved from the map by the caller; passing
     * it in keeps the map lookup and its absence check in one place.
     */
    commit(session, pending) {
        const current = this.fold(session);
        if (current.active !== pending.active || current.mode !== pending.mode) {
            session.append('ultracode/mode', { active: pending.active, mode: pending.mode });
        }
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
        if (keyword === undefined)
            return false;
        const pattern = new RegExp(`\\b${keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return messages.some(message => message.source.kind === 'user'
            && message.content.some(block => block.type === 'text' && pattern.test(block.text)));
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
        if (every <= 0 || step !== 1)
            return undefined;
        const state = this.fold(session);
        if (!state.active)
            return undefined;
        // Turn 1 is the prompt that started the session, and it already carried the
        // policy through the prompt section, so the first reminder lands a whole
        // interval later instead of immediately restating it.
        if (turn % every !== 0)
            return undefined;
        const text = `UltraCode is still on in ${state.mode} mode. Keep delegating substantive work `
            + 'with the ultracode_delegate tool rather than solving it solo.';
        return createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: 'ultracode', form: 'notice', summary: text },
        });
    }
    /** Build the user-switch notice for a mode change the model has not seen. */
    narration(session, target) {
        const told = this.fold(session);
        if (told.active === target.active && told.mode === target.mode)
            return undefined;
        const text = target.active
            ? `UltraCode is on in ${target.mode} mode.`
            : 'UltraCode is off.';
        return createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: 'ultracode', form: 'notice', summary: text },
        });
    }
    /** Resolve a `/ultracode` argument against the state it modifies. */
    commandTarget(raw, current) {
        const token = raw.trim().toLowerCase();
        if (token === 'off')
            return { active: false, mode: current.mode };
        if (token === '')
            return { active: !current.active, mode: current.mode };
        const mode = parseMode(token);
        if (mode === undefined)
            return undefined;
        return { active: true, mode };
    }
}
export default UltraCodeController;
//# sourceMappingURL=index.js.map