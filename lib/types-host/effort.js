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
export async function resolveRouteEffort(llm, route, signal) {
    if (route.effort === undefined)
        return undefined;
    let info;
    try {
        info = await llm.resolveModelInfo(route.provider, route.model, signal);
    }
    catch {
        // An unresolvable model leaves its ladder unknown; the caller drops the
        // effort, which is the same outcome as a model that does not expose one.
        return undefined;
    }
    return info.reasoning?.efforts.find(effort => effort.id === route.effort)?.id;
}
//# sourceMappingURL=effort.js.map