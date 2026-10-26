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
export async function readInputModalities(llm, route, signal) {
    try {
        const info = await llm.resolveModelInfo(route.provider, route.model, signal);
        return info.inputModalities;
    }
    catch {
        // A provider that cannot describe the model leaves capability unknown; the
        // caller treats unknown as negative capability, which is the safe reading.
        return undefined;
    }
}
/**
 * Whether a route accepts image input.
 * @param llm - the LLM service resolving model metadata.
 * @param route - the route to inspect.
 * @param signal - optional cancellation for adapter-owned lookup.
 * @returns whether the model declares `image` among its input modalities.
 */
export async function acceptsImages(llm, route, signal) {
    const modalities = await readInputModalities(llm, route, signal);
    return modalities !== undefined && modalities.includes('image');
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
export async function resolveVisionRoute(llm, pinned, catalog, signal) {
    if (pinned !== undefined) {
        if (await acceptsImages(llm, pinned, signal))
            return { kind: 'available', route: pinned };
        return {
            kind: 'unavailable',
            reason: 'unresolved',
            detail: `the pinned vision model "${pinned.model}" does not declare image input`,
        };
    }
    for (const route of catalog) {
        if (await acceptsImages(llm, route, signal))
            return { kind: 'available', route };
    }
    return {
        kind: 'unavailable',
        reason: 'no-vision-model',
        detail: catalog.length === 0
            ? 'no UltraCode model catalog is configured, so no image-capable route can be selected'
            : 'no configured UltraCode model declares image input',
    };
}
//# sourceMappingURL=vision.js.map