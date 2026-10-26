/**
 * Tier selection: which catalog entry each UltraCode role runs on for a given
 * cost mode. Pure resolution only — capability probing lives in `./vision.ts`,
 * where a model must actually be asked about its input modalities.
 *
 * @module @deepseek-ai/dsh-ultracode/routing
 */
import type { UltraCostMode, UltraModelRoute, UltraRoleRoutes } from './types.ts';
/** The resolved route per role for one active session. */
export interface UltraResolvedRoutes {
    /** The role that performs substantive work. */
    coder: UltraModelRoute;
    /** The role that validates and tests the coder's output. */
    validator: UltraModelRoute;
    /** The explicit vision route, when the deployment pinned one. */
    vision?: UltraModelRoute;
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
export declare function resolveRoleRoutes(mode: UltraCostMode, roles: UltraRoleRoutes, catalog: readonly UltraModelRoute[]): UltraResolvedRoutes;
/**
 * Whether a request addressed to one route must be handed to another because
 * the addressed model cannot accept images.
 * @param carriesImages - whether the work actually includes image content.
 * @param hasImageInput - the addressed model's image capability, where an
 *   explicit omission is negative capability.
 * @returns whether a vision handoff is required.
 */
export declare function needsVisionHandoff(carriesImages: boolean, hasImageInput: boolean): boolean;
//# sourceMappingURL=routing.d.ts.map