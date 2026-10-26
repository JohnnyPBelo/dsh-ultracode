/**
 * Vision handoff: turn image content into a text account a model without image
 * input can work from.
 *
 * The handoff runs where UltraCode routes work — before a delegated child
 * starts — rather than on the `llm/stream` waterfall. A request the agent loop
 * builds is a pure function of the session log, so replacing its images there
 * would make the request unreconstructable from that log; replacing them while
 * the delegation is still being composed keeps the log authoritative.
 *
 * @module @deepseek-ai/dsh-ultracode/handoff
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ContentBlock, ImageBlock, LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { UltraModelRoute } from './types.ts';
/** Capability-owned timeout reason code for one description call. */
export declare const VISION_HANDOFF_TIMEOUT_CODE = "ULTRACODE_VISION_HANDOFF_TIMEOUT";
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * One image description produced so a model without image input could
         * receive the content. Log-only and non-surface: the description is
         * model-visible input, so a replay must reproduce it from the log rather
         * than call the vision model again.
         */
        'ultracode/vision-handoff': {
            /** Provider of the route that read the images. */
            provider: string;
            /** Model of the route that read the images. */
            model: string;
            /** Model the described content was addressed to. */
            target: string;
            /** How many images were described. */
            images: number;
            /** The exact description text sent onward in place of the images. */
            description: string;
        };
    }
}
/** The instruction sent with the images. */
export declare const DESCRIBE_PROMPT: string;
/** Output-token cap for one description call. */
export declare const MAX_DESCRIPTION_TOKENS = 4000;
/** End-to-end deadline for one description call. */
export declare const DESCRIPTION_TIMEOUT_MS = 120000;
/** How one handoff resolved. */
export interface VisionHandoff {
    /** The blocks to send onward, with every image replaced by its description. */
    readonly content: ContentBlock[];
    /** The route that read the images. */
    readonly route: UltraModelRoute;
    /** How many images were described. */
    readonly images: number;
    /** The description text, when at least one image was described. */
    readonly description?: string;
}
/**
 * Whether a block list carries image content.
 * @param content - the blocks to inspect.
 * @returns whether any block is an image.
 */
export declare function carriesImages(content: readonly ContentBlock[]): boolean;
/**
 * Ask one image-capable route to describe the images a text-only route cannot read.
 * @param llm - the LLM service performing the description call.
 * @param route - the image-capable route.
 * @param images - the image blocks to describe.
 * @param sessionId - the session the request belongs to, for provider attribution.
 * @param signal - cancellation forwarded from the delegating call.
 * @returns the description text.
 */
export declare function describeImages(llm: LlmRuntime, route: UltraModelRoute, images: readonly ImageBlock[], sessionId: SessionId | undefined, signal: AbortSignal): Promise<string>;
/**
 * Replace every image block with a text account of it.
 * @param content - the blocks addressed to a model without image input.
 * @param description - the description the vision route produced.
 * @param model - the describing model, recorded in the replacement text.
 * @returns the blocks to send onward.
 */
export declare function replaceImages(content: readonly ContentBlock[], description: string, model: string): ContentBlock[];
//# sourceMappingURL=handoff.d.ts.map