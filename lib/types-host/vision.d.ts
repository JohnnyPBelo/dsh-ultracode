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
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { UltraModelRoute } from './types.ts';
/** Why a vision handoff could not be resolved. */
export type VisionUnavailableReason = 
/** No route in the search order declares image input. */
'no-vision-model'
/** The resolved route's metadata could not be read. */
 | 'unresolved';
/** Outcome of resolving a vision route. */
export type VisionResolution = {
    kind: 'available';
    route: UltraModelRoute;
} | {
    kind: 'unavailable';
    reason: VisionUnavailableReason;
    detail: string;
};
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
export declare function readInputModalities(llm: LlmRuntime, route: UltraModelRoute, signal?: AbortSignal): Promise<readonly string[] | undefined>;
/**
 * Whether a route accepts image input.
 * @param llm - the LLM service resolving model metadata.
 * @param route - the route to inspect.
 * @param signal - optional cancellation for adapter-owned lookup.
 * @returns whether the model declares `image` among its input modalities.
 */
export declare function acceptsImages(llm: LlmRuntime, route: UltraModelRoute, signal?: AbortSignal): Promise<boolean>;
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
export declare function resolveVisionRoute(llm: LlmRuntime, pinned: UltraModelRoute | undefined, catalog: readonly UltraModelRoute[], signal?: AbortSignal): Promise<VisionResolution>;
//# sourceMappingURL=vision.d.ts.map