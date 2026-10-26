/** Package-owned durable UltraCode invariants. @module @deepseek-ai/dsh-ultracode/invariant */
const PACKAGE_NAME = '@deepseek-ai/dsh-ultracode';
/** Cordis companion plugin name. */
export const name = 'ultracode-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * Validate one `ultracode/mode` event before it reaches the durable log.
 * The event is standalone whole-value state, so only its payload shape is
 * checkable — there is no enclosing turn to relate it to.
 */
function validateEvent(event, fail) {
    if (event.type !== 'ultracode/mode')
        return;
    const data = event.data;
    if (typeof data.active !== 'boolean') {
        fail(`ultracode/mode carries invalid active state ${JSON.stringify(data.active)}; expected a boolean`);
    }
    if (data.mode !== 'maximum' && data.mode !== 'frugal') {
        fail(`ultracode/mode carries invalid cost mode ${JSON.stringify(data.mode)}; expected "maximum" or "frugal"`);
    }
}
/**
 * Validate one `ultracode/vision-handoff` event before it reaches the durable log.
 * The description is model-visible input, so a replay depends on it being the
 * exact non-empty text that replaced the images.
 */
function validateHandoff(event, fail) {
    if (event.type !== 'ultracode/vision-handoff')
        return;
    const data = event.data;
    for (const field of ['provider', 'model', 'target']) {
        const value = data[field];
        if (typeof value !== 'string' || value === '') {
            fail(`ultracode/vision-handoff carries invalid ${field} ${JSON.stringify(value)}; expected a non-empty string`);
        }
    }
    if (typeof data.images !== 'number' || !Number.isSafeInteger(data.images) || data.images < 1) {
        fail(`ultracode/vision-handoff carries invalid images ${JSON.stringify(data.images)}; expected a positive integer`);
    }
    if (typeof data.description !== 'string' || data.description.trim() === '') {
        fail('ultracode/vision-handoff carries no description; a replay could not reproduce the request');
    }
}
/** Install validation for loaded and newly appended UltraCode state. */
const install = Object.assign((ctx, fail) => {
    const seed = (session) => {
        for (const event of session.events) {
            validateEvent(event, fail);
            validateHandoff(event, fail);
        }
    };
    for (const session of ctx.sessions.list())
        seed(session);
    ctx.on('session/created', (session) => { seed(session); }, { global: true });
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
        if (eventName !== 'session/event')
            return;
        const [, event] = args;
        validateEvent(event, fail);
        validateHandoff(event, fail);
    }, { global: true });
}, { inject: ['sessions'] });
/**
 * Register the UltraCode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map