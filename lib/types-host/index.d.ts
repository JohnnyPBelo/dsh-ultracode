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
import { Context, Service } from '@deepseek-ai/cordis';
import type { ZodType } from 'zod';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { UltraResolvedRoutes } from './routing.ts';
import type { VisionResolution } from './vision.ts';
import type { UltraCostMode, UltraModeState, UltraModelCatalog, UltraRoleRoutes } from './types.ts';
export type * from './types.ts';
export { resolveRoleRoutes, needsVisionHandoff } from './routing.ts';
export type { UltraResolvedRoutes } from './routing.ts';
export { resolveRouteEffort } from './effort.ts';
export { acceptsImages, readInputModalities, resolveVisionRoute } from './vision.ts';
export type { VisionResolution, VisionUnavailableReason } from './vision.ts';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Whether UltraCode policy is in force from this point on, and which cost
         * mode it selects. Log-only, non-surface, whole-value replace: the last
         * `ultracode/mode` wins and a log with none folds to inactive.
         */
        'ultracode/mode': {
            active: boolean;
            mode: UltraCostMode;
        };
        /**
         * One delegated task opened by a delegation this session owner started.
         * Log-only, non-surface. `taskId` is stable across every member and
         * outcome of that task, so a UI groups members by it without inferring
         * from tool-call arguments.
         */
        'ultracode/task': {
            taskId: string;
            /** The caller's short label for the task, shown as the group heading. */
            label: string;
            /** The cost mode in force when the task opened. */
            mode: UltraCostMode;
        };
        /**
         * One subagent started for a task. Log-only, non-surface. `childId` is the
         * child session id, which is what a UI opens; `role` and `model` are the
         * routing decision that actually applied, not a request.
         */
        'ultracode/member': {
            taskId: string;
            childId: string;
            role: UltraCodeRole;
            provider: string;
            model: string;
            /** Zero-based attempt index within the task; a frugal retry increments it. */
            round: number;
        };
        /**
         * One subagent settled. Log-only, non-surface. Exactly one per committed
         * `ultracode/member`, so a UI derives every member's state from the pair.
         */
        'ultracode/outcome': {
            taskId: string;
            childId: string;
            /** How the child stopped. `completed` is the only unconditional success. */
            stopReason: string;
            /** Whether the task treats this member's work as accepted. */
            accepted: boolean;
        };
        /**
         * One delegated task settled. Log-only, non-surface: the panel reads the
         * task list and the per-member rows from the events above, and this
         * closes the group.
         */
        'ultracode/task-end': {
            taskId: string;
            /** Whether the task produced work the caller may accept. */
            passed: boolean;
            /**
             * The deepest validation loop any member of this task took, not the sum
             * across members: a fan-out runs its subtasks concurrently, so the depth
             * is what bounds the task's duration.
             */
            rounds: number;
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        ultracode: UltraCodeController;
    }
}
/** The agent option UltraCode stamps on a child it routed, so a later step can classify it. */
declare module '@deepseek-ai/dsh-agent' {
    interface AgentOptions {
        /** The UltraCode role this child runs as, when UltraCode routed it. */
        ultracodeRole?: UltraCodeRole;
        /**
         * The catalog-declared effort id for a child UltraCode routed. Read on the
         * child's own `agent/request` and narrowed against that model's live ladder
         * before it becomes a request control; an id the model does not expose is
         * dropped, leaving the adapter default.
         */
        ultracodeEffort?: string;
    }
}
/** The roles UltraCode assigns to delegated work. */
export type UltraCodeRole = 'coder' | 'validator';
/**
 * The routing overlay UltraCode hands to a delegation seam.
 *
 * The route is always resolved: a child without a provider and model would
 * silently inherit the parent's, which is the one thing routing exists to
 * prevent.
 */
export interface UltraAgentOptions extends AgentOptions {
    readonly provider: string;
    readonly model: string;
    readonly ultracodeRole: UltraCodeRole;
    /**
     * The catalog-declared effort id for this route, before it is narrowed
     * against the live model. The controller stamps it on the request when the
     * model exposes that rung, so the child runs at the effort the catalog
     * selected rather than at the adapter default.
     */
    readonly ultracodeEffort?: string;
}
/** The command that switches UltraCode on, off, or between modes. */
export declare const ULTRACODE_COMMAND = "ultracode";
/** Deployment-owned UltraCode configuration. */
export interface UltraCodeConfig {
    /**
     * Guidance rendered as the `ultracode:policy` prompt section while UltraCode
     * is active. It owns the decomposition, fan-out, and validation instructions
     * the deployment wants the model to follow. `{mode}` is replaced with the
     * active cost mode, and `{routes}` with the resolved route per role, so one
     * instruction can state the policy the mode actually implements.
     */
    section: string;
    /** The ordered model catalog, best first. Required: no order is invented. */
    catalog: UltraModelCatalog;
    /** Per-role route pins that override tier selection. */
    roles?: UltraRoleRoutes;
    /** The mode a session starts in when the deployment pre-activates UltraCode. */
    mode?: UltraCostMode;
    /**
     * A word that, when it appears in a human-typed prompt, activates UltraCode
     * for the rest of the session.
     *
     * The Claude Code mode this plugin implements is reachable both ways: a
     * committed `/ultracode` command and the keyword in the prompt that asks for
     * deep work. Omission disables keyword activation, leaving the command as the
     * only switch.
     */
    keyword?: string;
    /**
     * How many of the session's own turns pass between the periodic reminders
     * that restate the active policy to the model.
     *
     * The Claude Code mode re-attaches its guidance on a fixed turn cadence so a
     * long session does not drift back to cheap single-agent habits once the
     * original prompt scrolls out of the window. Zero disables the reminders.
     */
    reminderEveryTurns?: number;
}
/** UltraCode projection state, persisted as plain JSON. */
export interface UltraProjectionState {
    /** Whether UltraCode policy is in force. */
    active: boolean;
    /** The active cost mode. */
    mode: UltraCostMode;
    /** A `/ultracode` selection awaiting its `ultracode/mode` commit. */
    wanted: UltraModeState | null;
    /** The command execution that produced `wanted`, awaiting its `command/done`. */
    running: {
        commandId: string;
        target: UltraModeState;
    } | null;
}
/** Config schema for the Loader. */
export declare const Config: ZodType<UltraCodeConfig>;
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
export declare function foldUltraCode(events: readonly SessionEvent[], end?: number, fallback?: UltraModeState): UltraModeState;
/**
 * Validate deployment config at load rather than at first use.
 * @param config - raw plugin config.
 * @returns a detached validated config.
 */
export declare function resolveConfig(config: UltraCodeConfig): UltraCodeConfig;
/**
 * UltraCode's session policy and model-routing service.
 *
 * The service exposes routing so other plugins (a delegation tool, an
 * orchestration UI) ask UltraCode which route a role should run on instead of
 * duplicating tier logic.
 */
export declare class UltraCodeController extends Service {
    static inject: string[];
    private readonly config;
    private readonly pendingIntents;
    /** The state a session that never committed a mode reads. */
    private readonly fallback;
    constructor(ctx: Context, config: UltraCodeConfig);
    /**
     * The model-facing guidance for one session's current policy.
     *
     * The resolved routes are interpolated rather than described generically: the
     * model cannot otherwise know which model a delegation lands on, and the
     * policy differs by mode in exactly that respect.
     * @param state - the mode to render, including a selection not yet committed.
     * @returns the assembled section text.
     */
    private sectionText;
    /** Fold one session's log against the deployment's configured fallback mode. */
    private fold;
    /**
     * Whether one agent's own loop is the top-level session UltraCode governs.
     *
     * A routed child carries `ultracodeRole`, so it is excluded: its rung comes
     * from its catalog route and must not be re-derived from the parent's mode.
     * @param agent - the agent whose request is being built.
     * @returns whether UltraCode policy governs this agent's own requests.
     */
    private isDeepWork;
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
    private ownEffort;
    /** Resolve the cheapest/best routes currently in force for one session. */
    routesFor(session: Session): UltraResolvedRoutes;
    /**
     * Read the UltraCode state in force for one session.
     * @param session - the session to fold.
     * @returns whether UltraCode is active and which cost mode is in force.
     */
    modeOf(session: Session): UltraModeState;
    /** Resolve the route that reads images for a coder that cannot. */
    visionRouteFor(session: Session, signal?: AbortSignal): Promise<VisionResolution>;
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
    agentOptionsFor(session: Session, role: UltraCodeRole): UltraAgentOptions;
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
    set(agent: Agent, target: UltraModeState): 'queued' | 'noop';
    /**
     * Append the pending selection once the step is accepted.
     * @param session - the session whose step was accepted.
     * @param pending - the selection resolved from the map by the caller; passing
     * it in keeps the map lookup and its absence check in one place.
     */
    private commit;
    /**
     * Whether any human-typed message in this step names the activation keyword.
     *
     * Only a real user prompt counts: a plugin notice, a tool result, or a model
     * message that happens to contain the word must not switch the mode, or a
     * delegation could activate UltraCode on its own.
     * @param messages - the user messages claimed for this step.
     * @returns whether one of them carried the keyword.
     */
    private requestedByKeyword;
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
    private reminder;
    /** Build the user-switch notice for a mode change the model has not seen. */
    private narration;
    /** Resolve a `/ultracode` argument against the state it modifies. */
    private commandTarget;
}
export default UltraCodeController;
export type { LlmRuntime };
//# sourceMappingURL=index.d.ts.map