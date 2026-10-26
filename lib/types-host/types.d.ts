/**
 * UltraCode's durable vocabulary: the two cost modes, the routing policy each
 * one selects, and the model tier each role runs on. No runtime code lives
 * here.
 *
 * @module @deepseek-ai/dsh-ultracode/types
 */
/** One provider/model route an UltraCode role may run on. */
export interface UltraModelRoute {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /**
     * The reasoning effort this route runs at when UltraCode delegates to it.
     * Omitted leaves the adapter's own default in force. Adapters declare their
     * effort ladder per model, so an id one model accepts another may reject;
     * UltraCode narrows this at call time and drops an unsupported id rather than
     * failing the delegation.
     */
    effort?: string;
}
/**
 * Which model each UltraCode role runs on.
 *
 * `coder` performs the work, `validator` judges and tests it, `vision` reads
 * images for a coder that cannot. Naming a role explicitly always wins over
 * tier selection, so a deployment can pin one role without pinning the rest.
 */
export interface UltraRoleRoutes {
    /** The role that performs substantive work. Absent selects by mode. */
    coder?: UltraModelRoute;
    /** The role that validates and tests the coder's output. Absent selects by mode. */
    validator?: UltraModelRoute;
    /**
     * The role that reads images on behalf of a coder without image input. Absent
     * asks the catalog for the first image-capable model in the configured order.
     */
    vision?: UltraModelRoute;
}
/**
 * A deployment's ordered model list, best first.
 *
 * UltraCode never invents an order: the array is authoritative, so the
 * operator's ranking, not a capability probe, decides what "best" means.
 */
export interface UltraModelCatalog {
    /**
     * Every route UltraCode may select, ordered best first. `frugal` mode uses
     * the cheapest entry for coding and the most expensive for validation;
     * `maximum` uses the first for both.
     */
    routes: readonly UltraModelRoute[];
}
/**
 * How UltraCode spends model quality across roles.
 *
 * - `maximum` puts the best model in the catalog on every role. Nothing is
 *   traded for cost.
 * - `frugal` keeps the same long-horizon decomposition and parallel fan-out but
 *   runs coding on the cheapest catalog model and validation on the most
 *   expensive, looping validation findings back to the coder until the code
 *   passes.
 */
export type UltraCostMode = 'maximum' | 'frugal';
/** What a session's UltraCode switch currently selects. */
export interface UltraModeState {
    /** Whether UltraCode policy is active for the session. */
    active: boolean;
    /** The active cost mode; only meaningful while `active`. */
    mode: UltraCostMode;
}
/**
 * The UltraCode projection's wire value. `active` and `mode` are the logged
 * state in force (the last `ultracode/mode`); `pending` is true while a logged
 * `/ultracode` selection targets a state other than the one in force, has not
 * failed through its paired `command/done`, and no later `ultracode/mode` event
 * has recorded that state. Capability absence (UltraCode not composed) is the
 * key's absence, never a value.
 */
export interface UltraCodeProjection {
    /** Whether UltraCode policy is in force. */
    active: boolean;
    /** The cost mode in force. */
    mode: UltraCostMode;
    /** Whether a selection is waiting to apply from the next step. */
    pending: boolean;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** UltraCode deep-work state folded from the command lifecycle and `ultracode/mode` events. */
        ultracode: UltraCodeProjection;
    }
}
//# sourceMappingURL=types.d.ts.map