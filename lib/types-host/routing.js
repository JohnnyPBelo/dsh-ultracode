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
    // Callers validate the catalog before resolving; this asserts the invariant
    // at the point the selection is made rather than at each read site.
    if (best === undefined || cheapest === undefined) {
        throw new RangeError('ultracode model catalog must contain at least one route');
    }
    if (mode === 'maximum')
        return best;
    return role === 'validator' ? best : cheapest;
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
export function resolveRoleRoutes(mode, roles, catalog) {
    return {
        coder: roles.coder ?? tierRoute(mode, 'coder', catalog),
        validator: roles.validator ?? tierRoute(mode, 'validator', catalog),
        ...roles.vision === undefined ? {} : { vision: roles.vision },
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
export function needsVisionHandoff(carriesImages, hasImageInput) {
    return carriesImages && !hasImageInput;
}
//# sourceMappingURL=routing.js.map