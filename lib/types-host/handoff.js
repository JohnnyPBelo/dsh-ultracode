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
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { deadline } from '@deepseek-ai/dsh-timeout';
/** Capability-owned timeout reason code for one description call. */
export const VISION_HANDOFF_TIMEOUT_CODE = 'ULTRACODE_VISION_HANDOFF_TIMEOUT';
/** The instruction sent with the images. */
export const DESCRIBE_PROMPT = 'Describe these images for a model that cannot see them. State every detail that bears on the '
    + 'current task: text as written, values, labels, colours, layout, and anything that differs from '
    + 'what one would assume. Report what is visible; do not interpret or advise.';
/** Output-token cap for one description call. */
export const MAX_DESCRIPTION_TOKENS = 4_000;
/** End-to-end deadline for one description call. */
export const DESCRIPTION_TIMEOUT_MS = 120_000;
/**
 * Whether a block list carries image content.
 * @param content - the blocks to inspect.
 * @returns whether any block is an image.
 */
export function carriesImages(content) {
    return content.some(block => block.type === 'image');
}
/**
 * Read the assembled text of one description response.
 *
 * The terminal finish reason is read before the text: a provider failure
 * arrives as a `finish` chunk with no blocks, so reporting "no description"
 * would report the absence rather than the cause.
 */
async function collectText(stream, signal) {
    const assembler = new BlockAssembler();
    for await (const chunk of stream) {
        signal.throwIfAborted();
        assembler.push(chunk);
    }
    signal.throwIfAborted();
    const finish = assembler.finish;
    if (finish.kind === 'error') {
        throw new Error(`the vision model failed: ${finish.failure.message}`);
    }
    if (finish.kind === 'aborted') {
        throw new Error(`the vision model call was aborted: ${finish.failure.message}`);
    }
    const text = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim();
    if (text === '')
        throw new Error('the vision model returned no description');
    return text;
}
/**
 * Ask one image-capable route to describe the images a text-only route cannot read.
 * @param llm - the LLM service performing the description call.
 * @param route - the image-capable route.
 * @param images - the image blocks to describe.
 * @param sessionId - the session the request belongs to, for provider attribution.
 * @param signal - cancellation forwarded from the delegating call.
 * @returns the description text.
 */
export async function describeImages(llm, route, images, sessionId, signal) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const callDeadline = __addDisposableResource(env_1, deadline(signal, DESCRIPTION_TIMEOUT_MS, VISION_HANDOFF_TIMEOUT_CODE), false);
        const message = createUserMessage({
            content: [{ type: 'text', text: DESCRIBE_PROMPT }, ...images],
            source: { kind: 'ultracode', form: 'notice', summary: 'UltraCode vision handoff' },
        });
        const options = {
            provider: route.provider,
            model: route.model,
            messages: [message],
            maxTokens: MAX_DESCRIPTION_TOKENS,
            ...sessionId === undefined ? {} : { sessionId },
            signal: callDeadline.signal,
        };
        return await collectText(llm.stream(options), callDeadline.signal);
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/**
 * Replace every image block with a text account of it.
 * @param content - the blocks addressed to a model without image input.
 * @param description - the description the vision route produced.
 * @param model - the describing model, recorded in the replacement text.
 * @returns the blocks to send onward.
 */
export function replaceImages(content, description, model) {
    let placed = false;
    const replaced = [];
    for (const block of content) {
        if (block.type !== 'image') {
            replaced.push(block);
            continue;
        }
        replaced.push({
            type: 'text',
            text: placed
                ? '[a further image, described in the note above]'
                : `[image described by ${model}, which the routed model cannot read]\n${description}`,
        });
        placed = true;
    }
    return replaced;
}
//# sourceMappingURL=handoff.js.map