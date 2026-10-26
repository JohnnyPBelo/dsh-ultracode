/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-tool-ultracode-delegate`.
 * @module @deepseek-ai/dsh-tool-ultracode-delegate/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-ultracode-delegate';
/** Cordis companion plugin name. */
export const name = 'tool-ultracode-delegate-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * Check the record this tool owns: every member it logs must name the task it
 * belongs to and the session it started, and every outcome must answer a
 * member already logged. A member without its task, or an outcome without its
 * member, would leave the orchestration panel with a row it cannot group or
 * settle.
 */
function validateMember(event, fail) {
    if (event.type === 'ultracode/task') {
        const data = event.data;
        if (typeof data.taskId !== 'string' || data.taskId === '') {
            fail('ultracode/task carries no taskId; a member could not be grouped under it');
        }
        if (typeof data.label !== 'string') {
            fail('ultracode/task carries no label string; the panel heading would be undefined');
        }
        return;
    }
    if (event.type === 'ultracode/member') {
        const data = event.data;
        for (const field of ['taskId', 'childId']) {
            const value = data[field];
            if (typeof value !== 'string' || value === '') {
                fail(`ultracode/member carries invalid ${field} ${JSON.stringify(value)}; expected a non-empty string`);
            }
        }
        if (typeof data.round !== 'number' || !Number.isSafeInteger(data.round) || data.round < 0) {
            fail(`ultracode/member carries invalid round ${JSON.stringify(data.round)}; expected a non-negative integer`);
        }
        return;
    }
    if (event.type === 'ultracode/outcome') {
        const data = event.data;
        for (const field of ['taskId', 'childId']) {
            const value = data[field];
            if (typeof value !== 'string' || value === '') {
                fail(`ultracode/outcome carries invalid ${field} ${JSON.stringify(value)}; no member could be settled`);
            }
        }
        if (typeof data.accepted !== 'boolean') {
            fail(`ultracode/outcome carries invalid accepted ${JSON.stringify(data.accepted)}; expected a boolean`);
        }
    }
}
/** Install validation for loaded and newly appended delegation records. */
const install = Object.assign((ctx, fail) => {
    const seed = (session) => {
        for (const event of session.events)
            validateMember(event, fail);
    };
    for (const session of ctx.sessions.list())
        seed(session);
    ctx.on('session/created', (session) => { seed(session); }, { global: true });
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [, event] = args;
        validateMember(event, fail);
    }, { global: true });
}, { inject: ['sessions'] });
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map