/**
 * Model-facing UltraCode delegation: one tool that starts a child on the route
 * UltraCode's active mode selects for it, handles the vision handoff when that
 * route cannot read the delegated images, and in `frugal` mode also drives the
 * validation loop that keeps a cheap coder iterating until an expensive
 * validator accepts the result.
 *
 * The tool owns routing enforcement because it is the operation that makes the
 * routing decision: a child started any other way keeps its inherited route.
 *
 * @module @deepseek-ai/dsh-tool-ultracode-delegate
 */
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { carriesImages, describeImages, replaceImages } from '@deepseek-ai/dsh-ultracode/handoff';
import { acceptsImages } from '@deepseek-ai/dsh-ultracode/vision';
export const name = 'tool-ultracode-delegate';
/**
 * The services this tool needs at registration time: the tool registry it
 * contributes to, the provider it delegates through, the prompt slot its
 * section occupies, the filesystem and attachment services its `images`
 * arguments load through, the LLM runtime its vision probe reads, and UltraCode
 * itself, whose routing and mode decide every call.
 */
export const inject = ['tools', 'subagents', 'systemPrompt', 'fs', 'attachments', 'llm', 'ultracode'];
/** Config schema for the Loader. */
export const Config = z.object({
    provider: z.string().min(1),
    toolName: z.string().min(1).optional(),
    maxValidationRounds: z.number().int().min(0).max(64).optional(),
    maxTaskTokens: z.number().int().min(1).optional(),
});
/** Prompt order: after bounded delegation policy, beside the subagent tool. */
const SECTION_ORDER = 116.6;
/** Default validation rounds before a frugal run reports an unresolved failure. */
const DEFAULT_MAX_VALIDATION_ROUNDS = 3;
const DESCRIPTION = 'Delegate substantive work to a subagent that UltraCode routes for you. '
    + 'Use this instead of the plain subagent tool while UltraCode is active: it starts the child on the '
    + 'model your cost mode selects, and in frugal mode it also runs the validator loop that reports '
    + 'required changes back to the coder until the code passes. '
    + 'Write a self-contained prompt: the child does not see this conversation.';
/**
 * Build the child's user content: the delegated prompt plus, on a validation
 * round, the findings the coder must address.
 * @param prompt - the task the caller delegated.
 * @param findings - validator findings from the previous round; empty on the first.
 * @param images - image blocks the caller attached, appended after the text.
 * @returns the model-facing content blocks.
 */
function childContent(prompt, findings, images = []) {
    const text = findings === ''
        ? prompt
        : `${prompt}\n\nThe validator rejected the previous attempt. Address every finding:\n\n${findings}`;
    return [{ type: 'text', text }, ...images];
}
/** Image extensions `images` accepts, mapping each to its declared media type. */
const IMAGE_EXTENSIONS = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};
/**
 * Load the caller-named images into durable attachment references.
 *
 * A model cannot emit image bytes inside a JSON argument, so `images` carries
 * paths: this reads each file, commits it through the attachment service (the
 * same lifecycle a read tool or an upload uses), and returns the image blocks
 * the child receives.
 * @param ctx - the plugin context carrying the filesystem and attachment services.
 * @param exec - the current tool execution, supplying cancellation.
 * @param cwd - the calling session's working directory, or undefined for one created without it.
 * @param paths - the caller-supplied image paths, in order.
 * @returns one image block per path.
 * @throws when a path is not an accepted image, is absent, or is over the deployment's byte limit.
 */
async function loadImages(ctx, exec, cwd, paths) {
    // `inject` lists `attachments`, so the service is present for every call this
    // plugin can serve: the fiber unloads with the store.
    const attachments = ctx.attachments;
    const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
    const blocks = [];
    for (const path of paths) {
        if (path.trim().length === 0)
            throw new Error('images must contain non-empty paths');
        const mediaType = IMAGE_EXTENSIONS[extname(path).toLowerCase()];
        if (mediaType === undefined) {
            throw new Error(`cannot attach "${path}": images accepts PNG/JPEG/WebP/GIF paths only`);
        }
        if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
            throw new Error(`cannot attach "${path}": ${mediaType} images are not accepted by this deployment`);
        }
        const target = await ctx.fs.resolve(path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal });
        const info = await ctx.fs.stat(target, exec.signal);
        if (info === undefined)
            throw new Error(`cannot attach "${target.displayPath}": not found`);
        if (info.type !== 'file')
            throw new Error(`cannot attach "${target.displayPath}": not a regular file`);
        const data = await ctx.fs.readBytes(target, exec.signal, byteCap);
        const ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) });
        blocks.push({ type: 'image', attachment: ref });
    }
    return blocks;
}
/** Render a settled child's output as text for the calling model. */
function resultText(result) {
    const blocks = result.output;
    const text = blocks
        .filter((block) => block.type === 'text')
        .map(block => block.text)
        .join('');
    return text.trim() === '' ? '(the subagent produced no text output)' : text;
}
/** Whether a settled child counts as a successful attempt. */
function succeeded(result) {
    return result.stopReason === 'completed' || result.stopReason === 'max-tokens';
}
/**
 * The validator's reply must be a decision, not prose. Asking for a sentence
 * that starts with `PASS` makes acceptance a substring match on free text, and
 * a validator that never answers in the protocol reads as a rejection — the
 * loop then keeps paying for the expensive model. A schema makes the answer
 * machine-readable at the seam that already validates it, so acceptance can
 * only be the boolean the validator returned.
 */
const VERDICT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['passed'],
    properties: {
        passed: {
            type: 'boolean',
            description: 'True only when the implementation is correct and its checks pass.',
        },
        findings: {
            type: 'string',
            description: 'The specific changes required, when passed is false.',
        },
    },
};
/**
 * Reduce findings text to the words that carry its meaning, so two reports of
 * the same defect compare equal across the whitespace and punctuation a fresh
 * validator rephrases freely.
 * @param findings - one validator's findings text.
 * @returns the words in order, lowercased and joined by single spaces.
 */
function findingsKey(findings) {
    return findings.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
}
/**
 * Read one validator decision from a settled child.
 *
 * A missing or malformed capture is a rejection, never an acceptance: the loop
 * spends money on every round, so the only safe default for an unreadable
 * answer is to treat it as work still to do.
 * @param result - the settled validator child's result.
 * @returns the decision, with the child's text as the findings when the
 *   capture carried none.
 */
function verdictOf(result) {
    const structured = result.structured;
    if (structured !== null && typeof structured === 'object' && 'passed' in structured) {
        if (typeof structured.passed === 'boolean') {
            const findings = 'findings' in structured ? structured.findings : undefined;
            return { passed: structured.passed, findings: typeof findings === 'string' ? findings : resultText(result) };
        }
    }
    return { passed: false, findings: resultText(result) };
}
/**
 * Whether this composition can hold a continuable child through `provider`.
 *
 * Three independent things must hold, and each is a deployment choice, so the
 * tool asks instead of assuming: the `agents` service cold-resumes an
 * Activation, a session-persistence backend durably releases each epoch, and
 * the selected provider contributes `prepareContinuable`. Method presence on
 * the provider IS that capability, so a provider without it is asked directly
 * rather than probed by attempting a start that would reserve a child first.
 * @param ctx - the calling context.
 * @param provider - the registered provider name this delegation would use.
 * @returns whether a continuable child can be established and resumed.
 */
function continuable(ctx, provider) {
    if (ctx.get('agents') === undefined || ctx.get('sessionPersistence') === undefined)
        return false;
    return ctx.subagents.getProvider(provider)?.prepareContinuable !== undefined;
}
/**
 * Arm an observer for one epoch's terminal edge of a specific child.
 *
 * A continuable child exposes no run handle to await, and reading its Session
 * after the fact races the settlement flush that must durably write it. The
 * lifecycle edge does not race: it fires once per epoch, after that epoch's
 * own output was captured while the child was still live. A cold resume is a
 * new epoch, so a child reused across rounds reports each round's own answer
 * instead of replaying the first.
 *
 * `wait()` must be armed BEFORE the message that opens the epoch, which is why
 * the caller reserves the child id first: an edge that arrives with no waiter
 * has nowhere to go, so arming late would hang the round rather than lose it
 * silently.
 * @param ctx - the calling context, whose dispatch sees this parent's children.
 * @param childId - the child whose epochs to observe.
 * @returns the waiter to arm before each send, plus its disposer.
 */
function epochObserver(ctx, childId) {
    /** The waiter parked for the next edge, if the caller armed one. */
    let parked;
    const release = () => {
        const waiting = parked;
        parked = undefined;
        return waiting;
    };
    const dispose = ctx.on('subagent/end', (info) => {
        if (info.id !== childId)
            return;
        release()?.resolve({
            result: {
                /* v8 ignore next -- an epoch that captured any output carries it, even
                 * an empty list; the field is absent only when teardown failed and
                 * withheld the output by design, which needs an injected failure. */
                output: info.lastAssistantMessage ?? [],
                stopReason: info.stopReason,
            },
            childId,
            usage: info.usage,
        });
    });
    return {
        wait: (signal) => new Promise((resolve, reject) => {
            const onAbort = () => {
                release()?.reject(new Error('the delegation was cancelled before its epoch settled'));
            };
            parked = { resolve, reject };
            signal.addEventListener('abort', onAbort, { once: true });
        }),
        dispose,
    };
}
/**
 * Start one child on a route, record it as a member of the calling task, and
 * settle it.
 *
 * The parent's log is the single source the orchestration panel reads: it
 * carries the task it belongs to, the routing that actually applied, and the
 * outcome. A member event and its outcome are appended around the same child,
 * so a replay reconstructs every row without the tool call.
 */
async function runOnce(ctx, provider, agent, role, content, options, taskId, round, signal, outputSchema) {
    const run = await ctx.subagents.start(provider, {
        label: role === 'validator' ? 'ultracode validation' : 'ultracode task',
        prompt: content,
        parent: agent,
        agentOptions: options,
        signal,
        ...outputSchema === undefined ? {} : { outputSchema },
    });
    const childId = run.id;
    recordMember(agent, taskId, childId, role, options, round);
    // The lifecycle edge is where a run's spend is published, and it settles
    // before `run.result` does; catching it here keeps the total off the
    // post-settlement registry, where the child is already unregistered. A
    // fan-out settles members concurrently, so the filter is what keeps one
    // member's edge from billing another.
    let usage;
    const stopWatching = ctx.on('subagent/end', (info) => {
        /* v8 ignore next -- unreachable while one dispatch's members settle in
         * arrival order: the handler only sees this child's edge before the
         * `finally` below unregisters it. A concurrently settling sibling would
         * reach it, which no composition currently produces. */
        if (info.id !== childId)
            return;
        usage = info.usage;
    });
    try {
        const result = await run.result;
        recordOutcome(agent, taskId, childId, result.stopReason, role === 'validator' && succeeded(result));
        return { result, childId, usage };
    }
    finally {
        stopWatching();
        await run.dispose();
    }
}
/**
 * Total billed tokens in one spend report.
 * @param usage - the provider's disjoint buckets, or `undefined` when unmeasured.
 * @returns the sum, or zero for an unmeasured member.
 */
function billedTokens(usage) {
    if (usage === undefined)
        return 0;
    return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
/**
 * Append one `ultracode/member` row and return the address the loop follows up
 * on. A member is recorded before it runs, so a replay that ends early still
 * shows the child that was started.
 */
function recordMember(agent, taskId, childId, role, options, round) {
    agent.session.append('ultracode/member', {
        taskId,
        childId,
        role,
        provider: options.provider,
        model: options.model,
        round,
    });
}
/** Append the `ultracode/outcome` row that closes one member. */
function recordOutcome(agent, taskId, childId, stopReason, accepted) {
    agent.session.append('ultracode/outcome', { taskId, childId, stopReason, accepted });
}
/**
 * Register the UltraCode delegation tool.
 * @param ctx - plugin context carrying the tool registry, subagents, and UltraCode.
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
    const toolName = config.toolName ?? 'ultracode_delegate';
    const maxRounds = config.maxValidationRounds ?? DEFAULT_MAX_VALIDATION_ROUNDS;
    ctx.systemPrompt.section({
        name: `tool:${toolName}`,
        order: SECTION_ORDER,
        text: () => `Use the ${toolName} tool to delegate substantive work while UltraCode is active.`,
    });
    ctx.tools.register(defineTool({
        name: toolName,
        description: DESCRIPTION,
        parameters: {
            description: {
                type: 'string',
                required: true,
                description: 'A short (3-5 word) description of the delegated task, for display.',
            },
            prompt: {
                type: 'string',
                description: 'A self-contained task description: the child does not see this conversation.',
            },
            tasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Several self-contained subtasks to run concurrently as members of this one task. '
                    + 'Use this instead of prompt to fan out.',
            },
            images: {
                type: 'array',
                items: { type: 'string' },
                description: 'PNG/JPEG/WebP/GIF paths to attach to every member. When the routed model cannot read '
                    + 'images, UltraCode asks an image-capable model to describe them first and the child receives '
                    + 'that description in their place.',
            },
            role: {
                type: 'string',
                enum: ['coder', 'validator'],
                description: 'Which UltraCode role the child runs as. Defaults to coder.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    role: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    passed: { type: 'boolean', required: true },
                    output: { type: 'string', required: true },
                    rounds: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: value.output }],
        },
        async execute(args, exec) {
            const agent = exec.agent;
            if (agent === undefined) {
                throw new Error(`${toolName} requires a calling agent (exec.agent was undefined)`);
            }
            const ultracode = ctx.ultracode;
            const state = ultracode.modeOf(agent.session);
            if (!state.active) {
                throw new Error('UltraCode is not active for this session; use the plain subagent tool, or ask the user to switch UltraCode on.');
            }
            const requested = args.role === 'validator' ? 'validator' : 'coder';
            // One task, one or many subtasks. The parent names the task once, and
            // every child started for it carries that id, so the panel groups a
            // fan-out under the heading the caller wrote.
            const prompts = args.prompt === undefined ? args.tasks ?? [] : [args.prompt];
            if (prompts.length === 0) {
                throw new Error(`${toolName} needs a prompt or at least one entry in tasks`);
            }
            const taskId = randomUUID();
            agent.session.append('ultracode/task', { taskId, label: args.description, mode: state.mode });
            // Load once per task, not per member: the child receives the same durable
            // references, and a fan-out does not re-read (or re-commit) the files.
            const attached = args.images === undefined || args.images.length === 0
                ? []
                : await loadImages(ctx, exec, agent.session.header.cwd, args.images);
            if (attached.length > 0 && args.tasks !== undefined) {
                throw new Error(`${toolName} accepts images with a single prompt, not with tasks`);
            }
            // The description is produced before the child starts, so the child's own
            // log stays a faithful record of what it was actually asked to do.
            const deliver = async (content, role) => {
                if (!carriesImages(content))
                    return content;
                const target = ultracode.agentOptionsFor(agent.session, role);
                if (await acceptsImages(ctx.llm, target, exec.signal))
                    return content;
                const resolution = await ultracode.visionRouteFor(agent.session, exec.signal);
                if (resolution.kind === 'unavailable') {
                    throw new Error(`UltraCode cannot route image content to "${target.model}": ${resolution.detail}. `
                        + 'Add an image-capable model to the catalog, pin one as the vision role, or send text only.');
                }
                const images = content.filter((block) => block.type === 'image');
                const description = await describeImages(ctx.llm, resolution.route, images, agent.session.id, exec.signal);
                agent.session.append('ultracode/vision-handoff', {
                    provider: resolution.route.provider,
                    model: resolution.route.model,
                    target: target.model,
                    images: images.length,
                    description,
                });
                return replaceImages(content, description, resolution.route.model);
            };
            // One monotonic counter across the whole dispatch: a fan-out runs several
            // subtasks' rounds concurrently, and each logged member must index the
            // task's attempt order, not the subtask's local round.
            let attempt = 0;
            /** One subtask end to end: route it, run it, and report its text. */
            const runTask = async (prompt) => {
                // `maximum` puts the best model everywhere and validates only when the
                // caller asked for it. `frugal` keeps the cheap coder but always runs
                // the expensive validator, looping findings back until it accepts.
                if (state.mode === 'maximum' || requested === 'validator') {
                    const index = attempt++;
                    const member = await runOnce(ctx, config.provider, agent, requested, await deliver(childContent(prompt, '', attached), requested), ultracode.agentOptionsFor(agent.session, requested), taskId, index, exec.signal);
                    return { passed: succeeded(member.result), text: resultText(member.result), rounds: 1 };
                }
                let findings = '';
                let rounds = 0;
                let last = '';
                // Spend is counted per task across every member, so a fan-out cannot
                // outrun a narrow task by splitting itself up.
                let spent = 0;
                // One coder child carries the whole loop when the composition can hold a
                // continuable child: the retry continues that child's own context, so it
                // keeps what it read and changed instead of re-deriving it from a fresh
                // transcript. A one-shot-only composition falls back to a child per
                // round, which is correct but pays for that re-reading every time.
                let coder;
                try {
                    while (rounds <= maxRounds) {
                        // Checked before a member starts, so a task already over budget does
                        // not pay for a round it would only abandon.
                        const budget = config.maxTaskTokens;
                        if (budget !== undefined && spent >= budget) {
                            return {
                                passed: false,
                                text: 'The task reached its token budget before the validator accepted the work'
                                    + ` (${String(spent)} of ${String(budget)} tokens).\n\n${findings}`,
                                rounds,
                            };
                        }
                        rounds++;
                        const index = attempt++;
                        const content = await deliver(childContent(prompt, findings, attached), 'coder');
                        const options = ultracode.agentOptionsFor(agent.session, 'coder');
                        let result;
                        const shared = continuable(ctx, config.provider);
                        if (!shared) {
                            const coded = await runOnce(ctx, config.provider, agent, 'coder', content, options, taskId, index, exec.signal);
                            result = coded.result;
                            spent += billedTokens(coded.usage);
                        }
                        else if (coder === undefined) {
                            // The identity is reserved by the caller so the observer can be
                            // armed before the child exists: `startContinuable` resolves only at
                            // inbox acceptance, but the epoch it opens can settle before this
                            // line runs, and an unarmed edge has nowhere to go.
                            const childId = SessionId(randomUUID());
                            const observer = epochObserver(ctx, childId);
                            const waiting = observer.wait(exec.signal);
                            coder = { childId, observer };
                            await ctx.subagents.startContinuable({
                                provider: config.provider,
                                label: 'ultracode task',
                                childId,
                                request: { prompt: content, parent: agent, agentOptions: options },
                                signal: exec.signal,
                            });
                            recordMember(agent, taskId, childId, 'coder', options, index);
                            const epoch = await waiting;
                            result = epoch.result;
                            spent += billedTokens(epoch.usage);
                        }
                        else {
                            // Same ordering for every later round: arm, then send.
                            const waiting = coder.observer.wait(exec.signal);
                            await ctx.subagents.followup(agent, SessionId(coder.childId), content, {
                                source: { kind: 'plugin', plugin: 'ultracode', form: 'relay' },
                                signal: exec.signal,
                            });
                            recordMember(agent, taskId, coder.childId, 'coder', options, index);
                            const epoch = await waiting;
                            result = epoch.result;
                            spent += billedTokens(epoch.usage);
                        }
                        // A shared coder is not disposed by `runOnce`, so its outcome row is
                        // appended here; the one-shot path records its own.
                        if (shared && coder !== undefined) {
                            recordOutcome(agent, taskId, coder.childId, result.stopReason, false);
                        }
                        last = resultText(result);
                        if (!succeeded(result))
                            return { passed: false, text: last, rounds };
                        // The validator judges the code the coder produced, so it receives
                        // that result rather than the caller's inputs. It runs the project's
                        // own checks instead of trusting the coder's account of them: the
                        // objective is a validated *and tested* result, and a validator that
                        // only reads would accept code whose tests never ran. A delegation
                        // whose validation needs the images themselves calls the tool again
                        // with role "validator", which attaches them to that member.
                        const validated = await runOnce(ctx, config.provider, agent, 'validator', childContent(`${prompt}\n\nValidate this implementation by running the project's own checks: `
                            + 'the test command and the typecheck or lint command this workspace declares. '
                            + `Report a failure with the command output that proves it.\n\n${last}`, ''), ultracode.agentOptionsFor(agent.session, 'validator'), taskId, index, exec.signal, VERDICT_SCHEMA);
                        spent += billedTokens(validated.usage);
                        const verdict = verdictOf(validated.result);
                        if (verdict.passed)
                            return { passed: true, text: last, rounds };
                        // `findings` still holds what this round's coder was told, so an
                        // unchanged answer means the next round would send the very same
                        // instruction to the very same child. No remaining count turns that
                        // into a different outcome, so the round is not worth paying for.
                        if (findingsKey(verdict.findings) === findingsKey(findings)) {
                            return {
                                passed: false,
                                text: 'The validator\'s findings did not change, so another round would send '
                                    + `the same instruction.\n\n${verdict.findings}`,
                                rounds,
                            };
                        }
                        findings = verdict.findings;
                    }
                    // The loop can only exit with findings: the first iteration sets them
                    // unless the coder failed, which returns earlier.
                    return {
                        passed: false,
                        text: `The validator still requires changes after ${String(rounds)} rounds.\n\n${findings}`,
                        rounds,
                    };
                }
                finally {
                    // A shared coder outlives its first epoch on purpose, so no `runOnce`
                    // disposal owns it. Only the observer needs releasing: the manager
                    // disposes a quiescent continuable child's Activation itself.
                    coder?.observer.dispose();
                }
            };
            // A fan-out runs every subtask concurrently: that parallelism is the
            // point of delegating one task as many members, and each member settles
            // into its own outcome row.
            const settled = await Promise.all(prompts.map(async (prompt) => runTask(prompt)));
            const passed = settled.every(entry => entry.passed);
            const rounds = Math.max(...settled.map(entry => entry.rounds));
            agent.session.append('ultracode/task-end', { taskId, passed, rounds });
            return {
                role: requested,
                model: ultracode.agentOptionsFor(agent.session, requested).model,
                passed,
                output: settled.map(entry => entry.text).join('\n\n---\n\n'),
                rounds,
            };
        },
    }));
}
//# sourceMappingURL=index.js.map