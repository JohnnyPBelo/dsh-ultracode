import { availableParallelism } from "node:os";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import schemastery from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session";
import { carriesImages, describeImages, replaceImages } from "./types-host/handoff.js";
import { acceptsImages } from "./types-host/vision.js";
import { SOURCE_KIND, appendUltraRecord, isRoutedChild } from "./host.js";
//#region lib/types/index.js
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
* Two subagent runtimes are supported: `subagents.start(provider, request)`
* (0.1.x) and `subagents.startActivation(spec)` (0.2.x). The shared continuable
* coder of `frugal` mode needs the 0.1.x continuation calls; without them every
* round starts a fresh coder.
*
* @module @deepseek-ai/dsh-tool-ultracode-delegate
*/
const name = "tool-ultracode-delegate";
/**
* The services this tool needs at registration time: the tool registry it
* contributes to, the provider it delegates through, the prompt slot its
* section occupies, the filesystem and attachment services its `images`
* arguments load through, the LLM runtime its vision probe reads, and UltraCode
* itself, whose routing and mode decide every call.
*/
/**
* Services a call cannot be served without.
*
* `fs` and `attachments` are deliberately absent: they carry the image handoff
* alone, and a deployment that mounts no filesystem or attachment store must
* lose that one argument rather than fail to activate. A Cordis entry naming an
* absent service stays `pending`, and both boot paths treat a pending entry as a
* fatal application error, so every optional dependency widens the set of
* compositions this plugin can take down. `loadImages` reads them where the
* `images` argument is used and reports the missing service there.
*/
const inject = [
	"tools",
	"subagents",
	"systemPrompt",
	"llm",
	"ultracode"
];
/**
* Config schema for the Loader.
*
* Declared in schemastery with every tunable volatile, which is what makes the
* Plugins page able to render and edit this row: the settings service builds a
* row's form from this schema and skips a row whose schema cannot describe an
* editable field. `provider` stays required and non-volatile because it is the
* provider seam, not a preference.
*/
const Config = schemastery.object({
	provider: schemastery.string().min(1),
	toolName: schemastery.string().min(1).volatile(),
	maxValidationRounds: schemastery.natural().max(64).volatile(),
	maxTaskTokens: schemastery.natural().min(1).volatile(),
	maxConcurrentMembers: schemastery.natural().max(64).volatile(),
	maxTransientRetries: schemastery.natural().max(10).volatile(),
	retryBackoffMs: schemastery.natural().max(60000).volatile()
});
/** Prompt order: after bounded delegation policy, beside the subagent tool. */
const SECTION_ORDER = 116.6;
/** Default validation rounds before a frugal run reports an unresolved failure. */
const DEFAULT_MAX_VALIDATION_ROUNDS = 3;

/**
 * Ceiling on the derived member concurrency. A fan-out's useful width is bounded
 * by the provider's throughput, not by the core count: past a point the extra
 * members only queue behind rate limits while each holds a session. This is a
 * protocol-level backstop for a model-supplied array, so it stays fixed.
 */
const DERIVED_CONCURRENCY_CEILING = 16;

/**
 * Resolve the member concurrency for one task.
 * @param configured - the deployment's `maxConcurrentMembers`, or undefined.
 * @returns how many members may run at once; at least 1.
 */
function resolveMaxConcurrentMembers(configured) {
	if (configured !== void 0 && configured > 0) return configured;
	return Math.min(DERIVED_CONCURRENCY_CEILING, Math.max(1, availableParallelism() - 2));
}

/**
 * Run `work` over `items` with at most `limit` running at once.
 *
 * Results keep the input order regardless of completion order, so a fan-out's
 * outcome rows stay aligned with the subtasks the caller wrote.
 * @param items - the work items, in caller order.
 * @param limit - how many may run concurrently; at least 1.
 * @param work - the operation for one item.
 * @returns one result per item, in input order.
 */
async function mapWithConcurrency(items, limit, work) {
	const results = new Array(items.length);
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await work(items[index]);
		}
	});
	await Promise.all(runners);
	return results;
}
const DESCRIPTION = "Delegate substantive work to a subagent that UltraCode routes for you. Use this instead of the plain subagent tool while UltraCode is active: it starts the child on the model your cost mode selects, and in frugal mode it also runs the validator loop that reports required changes back to the coder until the code passes.\n\nLong-horizon work: pass one entry in `tasks` per independently checkable unit, ordered so an earlier unit does not depend on a later one. A multi-hour migration, a large audit, or a feature spanning several areas splits into such units; one monolithic prompt covering all of it cannot be validated round by round and reports a single opaque failure instead of the unit that broke. Each entry must be self-contained: the child does not see this conversation, so state the paths, the commands, and the acceptance condition.";
/**
* Build the child's user content: the delegated prompt plus, on a validation
* round, the findings the coder must address.
* @param prompt - the task the caller delegated.
* @param findings - validator findings from the previous round; empty on the first.
* @param images - image blocks the caller attached, appended after the text.
* @returns the model-facing content blocks.
*/
function childContent(prompt, findings, images = []) {
	return [{
		type: "text",
		text: findings === "" ? prompt : `${prompt}\n\nThe validator rejected the previous attempt. Address every finding:\n\n${findings}`
	}, ...images];
}
/** Image extensions `images` accepts, mapping each to its declared media type. */
const IMAGE_EXTENSIONS = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif"
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
	// `fs` and `attachments` are optional dependencies, so this is the one place a
	// composition without them surfaces: the call asks for images and cannot read
	// them. Naming them in `inject` instead would leave the whole entry pending
	// and abort the application before any call is made.
	const attachments = ctx.get("attachments");
	if (attachments === void 0) throw new Error("images needs an attachment store: this deployment mounts no attachments service");
	const fs = ctx.get("fs");
	if (fs === void 0) throw new Error("images needs a filesystem: this deployment mounts no fs service");
	const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
	const blocks = [];
	for (const path of paths) {
		if (path.trim().length === 0) throw new Error("images must contain non-empty paths");
		const mediaType = IMAGE_EXTENSIONS[extname(path).toLowerCase()];
		if (mediaType === void 0) throw new Error(`cannot attach "${path}": images accepts PNG/JPEG/WebP/GIF paths only`);
		if (!attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`cannot attach "${path}": ${mediaType} images are not accepted by this deployment`);
		const target = await fs.resolve(path, {
			...cwd === void 0 ? {} : { cwd },
			signal: exec.signal
		});
		const info = await fs.stat(target, exec.signal);
		if (info === void 0) throw new Error(`cannot attach "${target.displayPath}": not found`);
		if (info.type !== "file") throw new Error(`cannot attach "${target.displayPath}": not a regular file`);
		const data = await fs.readBytes(target, exec.signal, byteCap);
		const ref = await attachments.saveImage({
			data,
			mediaType,
			name: basename(target.displayPath)
		});
		blocks.push({
			type: "image",
			attachment: ref
		});
	}
	return blocks;
}
/** Whether a settled child counts as a successful attempt. */
function succeeded(result) {
	return result.stopReason === "completed" || result.stopReason === "max-tokens";
}
/**
* Why a child did not succeed, in one line: its stop reason plus the
* provider-authored diagnostic when the runtime reports one.
* @param result - the settled child's result.
* @returns the account, or undefined for a successful child.
*/
function failureText(result) {
	if (succeeded(result)) return void 0;
	const diagnostic = typeof result.diagnostic === "string" && result.diagnostic.trim() !== "" ? `: ${result.diagnostic.trim()}` : "";
	return `[the subagent stopped with "${String(result.stopReason)}"${diagnostic}]`;
}
/**
* Render a settled child's output as text for the calling model. A child that
* did not complete says why, so a failure is never reported as silence.
* @param result - the settled child's result.
* @returns the text.
*/
function resultText(result) {
	const text = (result.output ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
	const failure = failureText(result);
	if (text.trim() === "") return failure ?? "(the subagent produced no text output)";
	return failure === void 0 ? text : `${text}\n\n${failure}`;
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
	type: "object",
	additionalProperties: false,
	required: ["passed"],
	properties: {
		passed: {
			type: "boolean",
			description: "True only when the implementation is correct and its checks pass."
		},
		findings: {
			type: "string",
			description: "The specific changes required, when passed is false."
		}
	}
};
/**
* Reduce findings text to the words that carry its meaning, so two reports of
* the same defect compare equal across the whitespace and punctuation a fresh
* validator rephrases freely.
* @param findings - one validator's findings text.
* @returns the words in order, lowercased and joined by single spaces.
*/
function findingsKey(findings) {
	return findings.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
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
	if (structured !== null && typeof structured === "object" && "passed" in structured) {
		if (typeof structured.passed === "boolean") {
			const findings = "findings" in structured ? structured.findings : void 0;
			return {
				passed: structured.passed,
				findings: typeof findings === "string" ? findings : resultText(result)
			};
		}
	}
	return {
		passed: false,
		findings: resultText(result)
	};
}
/**
* Whether this composition can hold a continuable child through `provider`.
*
* Four independent things must hold, and each is a deployment choice, so the
* tool asks instead of assuming: the subagent runtime offers the continuation
* calls (`startContinuable` and `followup`, 0.1.x), the `agents` service
* cold-resumes an Activation, a session-persistence backend durably releases
* each epoch, and the selected provider contributes `prepareContinuable`.
* Method presence on the provider IS that capability, so a provider without it
* is asked directly rather than probed by attempting a start that would
* reserve a child first.
* @param ctx - the calling context.
* @param provider - the registered provider name this delegation would use.
* @returns whether a continuable child can be established and resumed.
*/
function continuable(ctx, provider) {
	const subagents = ctx.subagents;
	if (typeof subagents.startContinuable !== "function" || typeof subagents.followup !== "function") return false;
	if (ctx.get("agents") === void 0 || ctx.get("sessionPersistence") === void 0) return false;
	return subagents.getProvider(provider)?.prepareContinuable !== void 0;
}
/**
* Start one child and return a run handle on either subagent runtime.
*
* 0.1.x: `subagents.start(provider, request)`. 0.2.x: `startActivation` with
* caller delivery (the tool returns the result; the parent model is not
* notified separately) and the user's delegation-depth limit when the provider
* enforces one. An activation's signal covers startup only, so a cancelled
* tool call disposes the activation itself.
* @param ctx - the plugin context carrying `subagents`.
* @param provider - the registered provider name.
* @param request - the start request (label, prompt, parent, agentOptions, signal, outputSchema).
* @returns `{ id, result, dispose }`.
*/
async function startChild(ctx, provider, request) {
	const subagents = ctx.subagents;
	if (typeof subagents.start === "function") return subagents.start(provider, request);
	if (typeof subagents.startActivation !== "function") throw new Error("this DeepSeek Harness subagent runtime offers neither start() nor startActivation()");
	const { label, signal, ...rest } = request;
	const depthLimit = subagents.getProvider?.(provider)?.capabilities?.depthLimit === true;
	const maxDepth = depthLimit && typeof subagents.resolveMaxDepth === "function" ? subagents.resolveMaxDepth() : void 0;
	const activation = await subagents.startActivation({
		provider,
		label,
		request: {
			...rest,
			...maxDepth === void 0 ? {} : { maxDepth }
		},
		signal,
		delivery: "caller"
	});
	let disposed;
	const dispose = () => {
		disposed ??= Promise.resolve().then(() => activation.dispose());
		return disposed;
	};
	const onAbort = () => {
		dispose().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	const result = Promise.resolve(activation.result).finally(() => {
		signal?.removeEventListener("abort", onAbort);
	});
	return {
		id: activation.childId,
		result,
		dispose
	};
}
/**
* Run two disposers as one.
* @param first - the first disposer.
* @param second - the second disposer.
* @returns a disposer that releases both, whichever settles first.
*/
function combinedDispose(first, second) {
	let done;
	return () => {
		done ??= Promise.resolve().then(() => {
			first();
			second();
		});
		return done;
	};
}
/**
* Deliver one child's terminal edge to the armed waiter.
*
* The lifecycle edge is the only settlement that does not race the child's own
* durable flush, and it fires once per epoch. The child's terminal error is read
* through `diagnostic` because the runtime reports a failed child as
* `stopReason: "error"` with no reason attached.
* @param ctx - the calling context, whose dispatch sees this parent's children.
* @param childId - the child whose edge settles the epoch.
* @param diagnostic - reads the error recorded for the epoch now ending.
* @param release - takes the armed waiter, if any.
* @returns the disposer that unregisters the listener.
*/
function settleOnEnd(ctx, childId, diagnostic, release) {
	return ctx.on("subagent/end", (info) => {
		if (info.id !== childId) return;
		const reason = diagnostic();
		release()?.resolve({
			result: {
				/* v8 ignore next -- an epoch that captured any output carries it, even
				* an empty list; the field is absent only when teardown failed and
				* withheld the output by design, which needs an injected failure. */
				output: info.lastAssistantMessage ?? [],
				stopReason: info.stopReason,
				...reason === void 0 ? {} : { diagnostic: reason }
			},
			childId,
			usage: info.usage
		});
	});
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
	/** The child's own terminal error during the current epoch. */
	let failure;
	const release = () => {
		const waiting = parked;
		parked = void 0;
		return waiting;
	};
	return {
		wait: (signal) => new Promise((resolve, reject) => {
			const onAbort = () => {
				release()?.reject(/* @__PURE__ */ new Error("the delegation was cancelled before its epoch settled"));
			};
			parked = {
				resolve,
				reject
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}),
		dispose: combinedDispose(settleOnEnd(ctx, childId, () => failure, release), ctx.on("session/event", (session, event) => {
			if (event.type !== "turn/end") return;
			if (session.id !== childId) return;
			failure = event.data.reason.kind === "error" ? errorText(event.data.reason.error) : void 0;
		}))
	};
}
/**
* Render a thrown value as the one line a caller can act on.
* @param error - the value a failed step threw.
* @returns the error's message, or its string form when it carries none.
*/
function errorText(error) {
	if (error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== "") return error.message;
	return String(error);
}
/**
* Start one child on a route, record it as a member of the calling task, and
* settle it.
*
* The parent's log is the single source the orchestration panel reads: it
* carries the task it belongs to, the routing that actually applied, and the
* outcome. A member record and its outcome are appended around the same child,
* so a replay reconstructs every row without the tool call.
* @param accept - whether the settled result counts as accepted (a validator's
*   verdict, or a coder's successful stop).
*/
async function runOnce(ctx, config, provider, agent, role, content, options, taskId, round, signal, outputSchema, accept = succeeded) {
	const retries = role === "validator" ? 0 : resolveRetries(config);
	let attempt = 0;
	for (;;) {
		attempt++;
		const member = await runAttempt(ctx, provider, agent, role, content, options, taskId, round, signal, outputSchema, accept);
		if (!transient(member.result) || attempt > retries) return member;
		await backoff(attempt, resolveBackoff(config), signal);
	}
}
/**
* One attempt at one child, recorded as its own member and outcome.
*
* Every attempt is a distinct member row so the orchestration panel shows the
* retry rather than hiding it behind a single success.
* @param ctx - the plugin context carrying `subagents`.
* @param provider - the registered provider name.
* @param agent - the calling agent.
* @param role - the route role this child plays.
* @param content - the message to deliver.
* @param options - the resolved route options.
* @param taskId - the task this member belongs to.
* @param round - the round index recorded on the member row.
* @param signal - the tool call's cancellation signal.
* @param outputSchema - the child's required answer schema, when it has one.
* @param accept - whether the settled result counts as accepted.
* @returns the settled attempt.
*/
async function runAttempt(ctx, provider, agent, role, content, options, taskId, round, signal, outputSchema, accept) {
	const run = await startChild(ctx, provider, {
		label: role === "validator" ? "ultracode validation" : "ultracode task",
		prompt: content,
		parent: agent,
		agentOptions: options,
		signal,
		...outputSchema === void 0 ? {} : { outputSchema }
	});
	const childId = run.id;
	const failure = captureFailure(ctx, childId);
	let usage;
	const stopWatching = ctx.on("subagent/end", (info) => {
		/* v8 ignore next -- unreachable while one dispatch's members settle in
		* arrival order: the handler only sees this child's edge before the
		* `finally` below unregisters it. A concurrently settling sibling would
		* reach it, which no composition currently produces. */
		if (info.id !== childId) return;
		usage = info.usage;
	});
	try {
		recordMember(agent, taskId, childId, role, options, round);
		const settled = await run.result;
		const result = withDiagnostic(settled, failure.read());
		recordOutcome(agent, taskId, childId, result.stopReason, accept(result));
		return {
			result,
			childId,
			usage
		};
	} finally {
		stopWatching();
		failure.dispose();
		await run.dispose();
	}
}
/**
* Read one child's own terminal error while it runs.
*
* The runtime reports a failed activation as `stopReason: "error"` with no
* reason attached, so a rate limit, an overloaded upstream, and a dropped stream
* all reach the caller as one opaque word. The child's own `turn/end` names the
* cause; this keeps it for the attempt that is about to settle.
* @param ctx - the calling context, whose dispatch sees this parent's children.
* @param childId - the child to watch.
* @returns the reader plus its disposer.
*/
function captureFailure(ctx, childId) {
	let failure;
	const dispose = ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		if (session.id !== childId) return;
		failure = event.data.reason.kind === "error" ? errorText(event.data.reason.error) : void 0;
	});
	return {
		read: () => failure,
		dispose
	};
}
/**
* Attach a diagnostic to a settled result that reported none.
* @param result - the settled child's result.
* @param diagnostic - the child's own terminal error, when it had one.
* @returns the result, carrying the diagnostic when it had none of its own.
*/
function withDiagnostic(result, diagnostic) {
	if (diagnostic === void 0) return result;
	if (typeof result.diagnostic === "string" && result.diagnostic.trim() !== "") return result;
	return {
		...result,
		diagnostic
	};
}
/**
* Whether a settled child failed for a reason that is worth another attempt.
*
* The range-leader model is reached through a shared upstream, so a long task
* ends on "service temporarily overloaded", a 429, or a dropped stream far more
* often than on a real defect. Retrying those is the difference between a
* multi-hour delegation that survives and one that surrenders its whole result
* to the last transient hiccup. A child that reported a genuine failure — a
* compile error, a rejected command — is not retried: the next attempt would
* repeat it.
* @param result - the settled child's result.
* @returns whether another attempt can be expected to behave differently.
*/
function transient(result) {
	if (result.stopReason !== "error") return false;
	const diagnostic = typeof result.diagnostic === "string" ? result.diagnostic : "";
	return TRANSIENT_PATTERN.test(diagnostic);
}
/** Provider-side failure text that a retry can plausibly outlast. */
const TRANSIENT_PATTERN = /overload|temporar|rate.?limit|too many requests|429|50[0234]|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|stream (?:closed|interrupted)|unavailable/i;
/**
* Wait before the next attempt, backing off so a saturated upstream is not hit
* in a tight loop.
* @param attempt - the 1-based number of the attempt that just failed.
* @param signal - the tool call's cancellation signal.
* @returns a promise that settles after the delay, or rejects on cancellation.
*/
function backoff(attempt, base, signal) {
	const delay = Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delay);
		const onAbort = () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("the delegation was cancelled while waiting to retry"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
/** Ceiling on one retry delay, so a long task resumes promptly after a hiccup. */
const MAX_BACKOFF_MS = 3e4;
/** Default attempts after the first for a child that hit a transient provider error. */
const DEFAULT_MAX_TRANSIENT_RETRIES = 3;
/** Default first retry delay; each further attempt doubles it. */
const DEFAULT_RETRY_BACKOFF_MS = 2000;
/**
* Resolve how many extra attempts a transient failure earns.
*
* A long-horizon delegation runs for hours against a shared upstream, so the
* default is deliberately not zero; a deployment that pays per attempt can set
* it lower from its own composition.
* @param config - the validated plugin config.
* @returns the number of retries after the first attempt.
*/
function resolveRetries(config) {
	return config.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
}
/**
* Resolve the first retry delay.
* @param config - the validated plugin config.
* @returns the delay in milliseconds before the second attempt.
*/
function resolveBackoff(config) {
	return config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
}
/**
* Total billed tokens in one spend report.
* @param usage - the provider's disjoint buckets, or `undefined` when unmeasured.
* @returns the sum, or zero for an unmeasured member.
*/
function billedTokens(usage) {
	if (usage === void 0) return 0;
	return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
/**
* Append one `member` record. A member is recorded before it runs, so a replay
* that ends early still shows the child that was started.
*/
function recordMember(agent, taskId, childId, role, options, round) {
	appendUltraRecord(agent.session, "member", {
		taskId,
		childId,
		role,
		provider: options.provider ?? "",
		model: options.model ?? "",
		round
	});
}
/** Append the `outcome` record that closes one member. */
function recordOutcome(agent, taskId, childId, stopReason, accepted) {
	appendUltraRecord(agent.session, "outcome", {
		taskId,
		childId,
		stopReason,
		accepted
	});
}
/**
* Resolve a volatile field to its value.
* @param field - a live settings reference, or a plain value in a raw config.
* @returns the value, or undefined when the field is absent.
*/
function plainValue(field) {
	if (field === void 0 || field === null) return void 0;
	if (typeof field === "object" && typeof field.get === "function") return field.get();
	return field;
}
/**
* Unwrap every volatile field of this row's config.
* @param raw - the config the Loader validated.
* @returns the same fields as plain values.
*/
function unwrapConfig(raw) {
	const out = {};
	for (const key of [
		"provider",
		"toolName",
		"maxValidationRounds",
		"maxTaskTokens",
		"maxConcurrentMembers",
		"maxTransientRetries",
		"retryBackoffMs"
	]) {
		const value = plainValue(raw[key]);
		if (value !== void 0) out[key] = value;
	}
	return out;
}
/**
* Register the UltraCode delegation tool.
* @param ctx - plugin context carrying the tool registry, subagents, and UltraCode.
* @param config - validated plugin config.
*/
function apply(ctx, rawConfig) {
	// A volatile schemastery field resolves to a LIVE reference with `get()`, not
	// to a value, so every read of this row's config goes through one unwrapper.
	// Reading `config.toolName` directly would compare a reference against a
	// string and silently fall back to the default forever.
	const config = unwrapConfig(rawConfig);
	const toolName = config.toolName ?? "ultracode_delegate";
	const maxRounds = config.maxValidationRounds ?? DEFAULT_MAX_VALIDATION_ROUNDS;
	ctx.systemPrompt.section({
		name: `tool:${toolName}`,
		order: SECTION_ORDER,
		text: (context) => {
			const agent = context?.agent;
			if (agent === void 0 || isRoutedChild(agent)) return "";
			if (!ctx.ultracode.modeOf(agent.session).active) return "";
			return [
				`Use the ${toolName} tool to delegate substantive work while UltraCode is active.`,
				"",
				"A delegation may run for hours. The child owns that work, so do not abandon it, poll it, or re-plan it while it runs: one call is the whole task. Write the prompt for the child that has to finish it alone — state the working directory, the checks that prove the work, and what to report. The child cannot see this conversation and cannot ask you a question.",
				"",
				"A child that hits an overloaded provider, a rate limit, or a dropped stream is retried automatically and keeps its earlier progress. When a task still reports a failure, that report carries the child's own error text and its partial output: read it and continue from there instead of starting the same work again."
			].join("\n");
		}
	});
	ctx.tools.register(defineTool({
		name: toolName,
		description: DESCRIPTION,
		parameters: {
			description: {
				type: "string",
				required: true,
				description: "A short (3-5 word) description of the delegated task, for display."
			},
			prompt: {
				type: "string",
				description: "A self-contained task description: the child does not see this conversation."
			},
			tasks: {
				type: "array",
				items: { type: "string" },
				description: "Several self-contained subtasks to run concurrently as members of this one task. Use this instead of prompt to fan out."
			},
			images: {
				type: "array",
				items: { type: "string" },
				description: "PNG/JPEG/WebP/GIF paths to attach to every member. When the routed model cannot read images, UltraCode asks an image-capable model to describe them first and the child receives that description in their place."
			},
			role: {
				type: "string",
				enum: ["coder", "validator"],
				description: "Which UltraCode role the child runs as. Defaults to coder."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					role: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					passed: {
						type: "boolean",
						required: true
					},
					output: {
						type: "string",
						required: true
					},
					rounds: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.output
			}]
		},
		async execute(args, exec) {
			const agent = exec.agent;
			if (agent === void 0) throw new Error(`${toolName} requires a calling agent (exec.agent was undefined)`);
			if (isRoutedChild(agent)) throw new Error(`${toolName} is not available inside an UltraCode-routed subagent; do the work directly.`);
			const ultracode = ctx.ultracode;
			const state = ultracode.modeOf(agent.session);
			if (!state.active) throw new Error("UltraCode is not active for this session; use the plain subagent tool, or ask the user to switch UltraCode on.");
			const requested = args.role === "validator" ? "validator" : "coder";
			const prompts = args.prompt === void 0 ? args.tasks ?? [] : [args.prompt];
			if (prompts.length === 0) throw new Error(`${toolName} needs a prompt or at least one entry in tasks`);
			// An entry that carries no work would still start a child, spend a
			// provider request, and report an empty result as success.
			if (prompts.some((prompt) => prompt.trim().length === 0)) throw new Error(`${toolName} refuses an empty prompt: every entry in tasks must carry work`);
			const notes = new Set();
			/** Resolve one role's child options, collecting any route-fallback note. */
			const optionsFor = async (role) => {
				const resolved = await ultracode.childOptionsFor(agent, role, exec.signal);
				for (const note of resolved.notes) notes.add(note);
				return resolved;
			};
			const primary = await optionsFor(requested);
			const attached = args.images === void 0 || args.images.length === 0 ? [] : await loadImages(ctx, exec, agent.session.header.cwd, args.images);
			if (attached.length > 0 && args.tasks !== void 0) throw new Error(`${toolName} accepts images with a single prompt, not with tasks`);
			const taskId = randomUUID();
			appendUltraRecord(agent.session, "task", {
				taskId,
				label: args.description,
				mode: state.mode
			});
			const deliver = async (content, resolved) => {
				if (!carriesImages(content)) return content;
				const target = resolved.route;
				if (target !== void 0 && await acceptsImages(ctx.llm, target, exec.signal)) return content;
				const resolution = await ultracode.visionRouteFor(agent, exec.signal);
				if (resolution.kind === "unavailable") throw new Error(`UltraCode cannot route image content to "${target?.model ?? "the session model"}": ${resolution.detail}. Add an image-capable model to the catalog, pin one as the vision role, or send text only.`);
				const images = content.filter((block) => block.type === "image");
				const description = await describeImages(ctx.llm, resolution.route, images, agent.session.id, exec.signal);
				appendUltraRecord(agent.session, "vision-handoff", {
					provider: resolution.route.provider,
					model: resolution.route.model,
					target: target?.model ?? "",
					images: images.length,
					description
				});
				return replaceImages(content, description, resolution.route.model);
			};
			let attempt = 0;
			let unmeasured = false;
			/** One subtask end to end: route it, run it, and report its text. */
			const runTask = async (prompt) => {
				if (state.mode === "maximum" || requested === "validator") {
					const index = attempt++;
					const member = await runOnce(ctx, config, config.provider, agent, requested, await deliver(childContent(prompt, "", attached), primary), primary.options, taskId, index, exec.signal);
					return {
						passed: succeeded(member.result),
						text: resultText(member.result),
						rounds: 1
					};
				}
				let findings = "";
				let rounds = 0;
				let last = "";
				let spent = 0;
				let coder;
				try {
					while (rounds <= maxRounds) {
						const budget = config.maxTaskTokens;
						if (budget !== void 0 && spent >= budget) return {
							passed: false,
							text: `The task reached its token budget before the validator accepted the work (${String(spent)} of ${String(budget)} tokens).\n\n${findings}`,
							rounds
						};
						rounds++;
						const index = attempt++;
						const coderOptions = await optionsFor("coder");
						const content = await deliver(childContent(prompt, findings, attached), coderOptions);
						const options = coderOptions.options;
						let result;
						let usage;
						const shared = continuable(ctx, config.provider);
						if (!shared) {
							const coded = await runOnce(ctx, config, config.provider, agent, "coder", content, options, taskId, index, exec.signal);
							result = coded.result;
							usage = coded.usage;
						} else if (coder === void 0) {
							const childId = SessionId(randomUUID());
							const observer = epochObserver(ctx, childId);
							const waiting = observer.wait(exec.signal);
							coder = {
								childId,
								observer
							};
							await ctx.subagents.startContinuable({
								provider: config.provider,
								label: "ultracode task",
								childId,
								request: {
									prompt: content,
									parent: agent,
									agentOptions: options
								},
								signal: exec.signal
							});
							recordMember(agent, taskId, childId, "coder", options, index);
							const epoch = await waiting;
							result = epoch.result;
							usage = epoch.usage;
						} else {
							const waiting = coder.observer.wait(exec.signal);
							await ctx.subagents.followup(agent, SessionId(coder.childId), content, {
								source: {
									kind: SOURCE_KIND,
									form: "relay"
								},
								signal: exec.signal
							});
							recordMember(agent, taskId, coder.childId, "coder", options, index);
							const epoch = await waiting;
							result = epoch.result;
							usage = epoch.usage;
						}
						if (usage === void 0) unmeasured = true;
						spent += billedTokens(usage);
						if (shared && coder !== void 0) recordOutcome(agent, taskId, coder.childId, result.stopReason, succeeded(result));
						last = resultText(result);
						if (!succeeded(result)) return {
							passed: false,
							text: last,
							rounds
						};
						const validatorOptions = await optionsFor("validator");
						const validated = await runOnce(ctx, config, config.provider, agent, "validator", childContent(`${prompt}\n\nValidate this implementation by running the project's own checks: the test command and the typecheck or lint command this workspace declares. Report a failure with the command output that proves it.\n\n${last}`, ""), validatorOptions.options, taskId, index, exec.signal, VERDICT_SCHEMA, (settled) => verdictOf(settled).passed);
						if (validated.usage === void 0) unmeasured = true;
						spent += billedTokens(validated.usage);
						const verdict = verdictOf(validated.result);
						if (verdict.passed) return {
							passed: true,
							text: last,
							rounds
						};
						if (findingsKey(verdict.findings) === findingsKey(findings)) return {
							passed: false,
							text: `The validator's findings did not change, so another round would send the same instruction.\n\n${verdict.findings}`,
							rounds
						};
						findings = verdict.findings;
					}
					return {
						passed: false,
						text: `The validator still requires changes after ${String(rounds)} rounds.\n\n${findings}`,
						rounds
					};
				} finally {
					coder?.observer.dispose();
				}
			};
			const settled = await mapWithConcurrency(prompts, resolveMaxConcurrentMembers(config.maxConcurrentMembers), runTask);
			const passed = settled.every((entry) => entry.passed);
			const rounds = Math.max(...settled.map((entry) => entry.rounds));
			appendUltraRecord(agent.session, "task-end", {
				taskId,
				passed,
				rounds
			});
			if (config.maxTaskTokens !== void 0 && unmeasured) notes.add("maxTaskTokens was not enforced: this DeepSeek Harness does not report per-run token usage for subagents.");
			const output = settled.map((entry) => entry.text).join("\n\n---\n\n");
			return {
				role: requested,
				model: primary.route?.model ?? "",
				passed,
				output: notes.size === 0 ? output : `${output}\n\n${[...notes].join("\n")}`,
				rounds
			};
		}
	}), { when: ({ agent }) => !isRoutedChild(agent) });
}
//#endregion
export { Config, DESCRIPTION, apply, continuable, failureText, inject, name, resultText, startChild, succeeded, verdictOf };
