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
import type { Context } from '@deepseek-ai/cordis';
import type { ZodType } from 'zod';
export declare const name = "tool-ultracode-delegate";
/**
 * The services this tool needs at registration time: the tool registry it
 * contributes to, the provider it delegates through, the prompt slot its
 * section occupies, the filesystem and attachment services its `images`
 * arguments load through, the LLM runtime its vision probe reads, and UltraCode
 * itself, whose routing and mode decide every call.
 */
export declare const inject: string[];
/** The tool's config: which `ctx.subagents` provider it delegates through. */
export interface Config {
    /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`). */
    provider: string;
    /** Model-facing tool name. Each loaded instance must use a distinct name. */
    toolName?: string;
    /**
     * How many validator rejections a `frugal`-mode run may take before the tool
     * reports failure instead of looping forever. A non-negative safe integer.
     * A rejection that repeats the findings the coder already had ends the loop
     * earlier: the next round would resend that instruction.
     */
    maxValidationRounds?: number;
    /**
     * Total provider-billed tokens one `frugal`-mode task may spend before it
     * stops. A positive safe integer, counted across every member the task runs,
     * so a fan-out spends from one budget rather than one per subtask.
     *
     * The check runs before a member starts, so a task can exceed the budget by
     * the cost of the member that crossed it. A member whose provider reported no
     * usage adds nothing measurable: the budget constrains what was billed and
     * seen, never a figure the tool invented.
     */
    maxTaskTokens?: number;
}
/** Config schema for the Loader. */
export declare const Config: ZodType<Config>;
/**
 * Register the UltraCode delegation tool.
 * @param ctx - plugin context carrying the tool registry, subagents, and UltraCode.
 * @param config - validated plugin config.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map