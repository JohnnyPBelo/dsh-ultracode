// Delegation tool: both subagent runtimes, routing, records, failures, visibility.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as host from '../lib/host.js'
import * as delegate from '../lib/delegate.js'
import { bootHost, fakeSystemPrompt, legacyAgent, modernAgent, newSession, settle, ultraRecords } from './support/fixtures.mjs'

const BUNDLE = { mode: 'maximum', keyword: 'ultracode', reminderEveryTurns: 10 }
const text = value => [{ type: 'text', text: value }]

/** A 0.2.x subagent runtime: startActivation + sendMessage, no start(). */
function activationRuntime(results) {
  const started = []
  const disposed = []
  return {
    started,
    disposed,
    resolveMaxDepth: () => 2,
    getProvider: () => ({ name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true }, prepareContinuable() {} }),
    async startActivation(spec) {
      started.push(spec)
      const childId = `child-${String(started.length)}`
      const next = results.shift() ?? { output: text('ok'), stopReason: 'completed' }
      let settle
      const result = typeof next === 'function' ? new Promise(resolve => { settle = resolve }) : Promise.resolve(next)
      return { childId, result, dispose: async () => { disposed.push(childId); settle?.({ output: [], stopReason: 'aborted' }) } }
    },
    sendMessage() { throw new Error('not used') },
  }
}

/** A 0.1.x subagent runtime: start(provider, request). */
function startRuntime(results) {
  const started = []
  return {
    started,
    getProvider: () => ({ name: 'spawn' }),
    async start(provider, request) {
      started.push({ provider, request })
      return { id: `child-${String(started.length)}`, result: Promise.resolve(results.shift() ?? { output: text('ok'), stopReason: 'completed' }), dispose: async () => {} }
    },
  }
}

async function bootDelegate({ subagents, hostConfig = BUNDLE, delegateConfig = { provider: 'spawn' }, extra = {} }) {
  const tools = { registered: [], register(definition, options) { this.registered.push({ definition, options }); return () => {} } }
  const systemPrompt = fakeSystemPrompt()
  const booted = await bootHost(host.UltraCodeController, hostConfig, {
    systemPrompt,
    tools,
    subagents,
    fs: {},
    attachments: { imageLimits: { maxImageBytes: 1, maxMessageImageBytes: 1, mediaTypes: [] } },
    ...extra,
  })
  await booted.root.plugin(delegate, delegateConfig)
  await settle()
  const [{ definition, options }] = tools.registered
  return { ...booted, tools, systemPrompt, definition, options }
}

function activeSession(mode = 'maximum') {
  const session = newSession()
  host.appendUltraRecord(session, 'mode', { active: true, mode })
  return session
}

const exec = (agent, signal = new AbortController().signal) => ({ agent, signal })

// `fs` and `attachments` carry the image handoff alone. Naming them in `inject`
// would leave the entry pending on any composition without them, and both boot
// paths treat a pending entry as a fatal application error — a text-only
// delegation would take the whole application down with it.
describe('optional dependencies', () => {
  test('activates with neither fs nor attachments mounted', async () => {
    const subagents = activationRuntime([{ output: text('child answer'), stopReason: 'completed' }])
    const tools = { registered: [], register(definition, options) { this.registered.push({ definition, options }); return () => {} } }
    const booted = await bootHost(host.UltraCodeController, BUNDLE, { systemPrompt: fakeSystemPrompt(), tools, subagents })
    const fiber = await booted.root.plugin(delegate, { provider: 'spawn' })
    await settle()

    assert.equal(fiber.state, 2, 'the delegate entry must reach ACTIVE without fs or attachments')
    assert.equal(booted.root.get('fs'), undefined)
    assert.equal(booted.root.get('attachments'), undefined)
    assert.equal(tools.registered.length, 1)
  })

  test('reports the missing service when images are requested', async () => {
    const subagents = activationRuntime([{ output: text('child answer'), stopReason: 'completed' }])
    const tools = { registered: [], register(definition, options) { this.registered.push({ definition, options }); return () => {} } }
    const booted = await bootHost(host.UltraCodeController, BUNDLE, { systemPrompt: fakeSystemPrompt(), tools, subagents })
    await booted.root.plugin(delegate, { provider: 'spawn' })
    await settle()

    const session = activeSession()
    const agent = { session, options: {}, inject() {}, model: undefined }
    await assert.rejects(
      () => tools.registered[0].definition.execute({ description: 'x', prompt: 'go', images: ['/tmp/whatever.png'] }, exec(agent)),
      /images needs an attachment store/,
    )
  })
})

const kinds = session => ultraRecords(session).map(event => host.ultraEventType(event))

describe('0.2.x subagent runtime (startActivation)', () => {
  test('maximum mode: caller delivery, depth limit, routed options, and the full record trail', async () => {
    const subagents = activationRuntime([{ output: text('child answer'), stopReason: 'completed' }])
    const { definition } = await bootDelegate({ subagents })
    const session = activeSession()
    const value = await definition.execute({ description: 'probe task', prompt: 'do it' }, exec(modernAgent(session)))
    assert.equal(value.passed, true)
    assert.equal(value.output, 'child answer')
    assert.equal(value.model, 'flash')
    const [spec] = subagents.started
    assert.equal(spec.delivery, 'caller')
    assert.equal(spec.label, 'ultracode task')
    assert.equal(spec.request.maxDepth, 2)
    assert.deepEqual(spec.request.agentOptions, { provider: 'openrouter', model: 'flash', ultracodeRole: 'coder', reasoningEffort: 'max' })
    assert.equal(spec.request.signal, undefined, 'the activation signal travels beside the request')
    assert.deepEqual(kinds(session), ['ultracode/mode', 'ultracode/task', 'ultracode/member', 'ultracode/outcome', 'ultracode/task-end'])
    const outcome = ultraRecords(session).find(event => host.ultraEventType(event) === 'ultracode/outcome')
    assert.deepEqual({ ...outcome.data }, { taskId: outcome.data.taskId, childId: 'child-1', stopReason: 'completed', accepted: true })
    assert.deepEqual(subagents.disposed, ['child-1'])
  })
  test('frugal mode runs a fresh coder per round and loops until the validator passes', async () => {
    const subagents = activationRuntime([
      { output: text('attempt 1'), stopReason: 'completed' },
      { output: [], structured: { passed: false, findings: 'add a test' }, stopReason: 'completed' },
      { output: text('attempt 2'), stopReason: 'completed' },
      { output: [], structured: { passed: true }, stopReason: 'completed' },
    ])
    const { definition } = await bootDelegate({ subagents, extra: { agents: {}, sessionPersistence: {} } })
    const session = activeSession('frugal')
    const value = await definition.execute({ description: 'frugal', prompt: 'build it' }, exec(modernAgent(session)))
    assert.equal(value.passed, true)
    assert.equal(value.rounds, 2)
    assert.equal(value.output, 'attempt 2')
    assert.equal(subagents.started.length, 4, 'no continuation calls on 0.2.x, so every round starts a fresh coder')
    const [coder, validator, coder2] = subagents.started
    assert.equal(coder.request.agentOptions.reasoningEffort, 'low')
    assert.equal(validator.request.agentOptions.reasoningEffort, 'max')
    assert.equal(validator.label, 'ultracode validation')
    assert.ok(validator.request.outputSchema.properties.passed)
    assert.match(coder2.request.prompt[0].text, /Address every finding:\n\nadd a test/)
    const outcomes = ultraRecords(session).filter(event => host.ultraEventType(event) === 'ultracode/outcome').map(event => event.data.accepted)
    assert.deepEqual(outcomes, [true, false, true, true], 'the rejecting validator is recorded as not accepted')
  })
  test('a failed child reports its stop reason and diagnostic instead of silence', async () => {
    const subagents = activationRuntime([{ output: [], stopReason: 'error', diagnostic: 'no API key for provider route "deepseek-official"' }])
    const { definition } = await bootDelegate({ subagents })
    const session = activeSession()
    const value = await definition.execute({ description: 'fails', prompt: 'x' }, exec(modernAgent(session)))
    assert.equal(value.passed, false)
    assert.match(value.output, /stopped with "error": no API key for provider route "deepseek-official"/)
    assert.equal(ultraRecords(session).at(-1).data.passed, false)
  })
  test('cancelling the tool call disposes the activation', async () => {
    const subagents = activationRuntime([() => {}])
    const { definition } = await bootDelegate({ subagents })
    const controller = new AbortController()
    const running = definition.execute({ description: 'cancel', prompt: 'x' }, exec(modernAgent(activeSession()), controller.signal))
    await settle()
    controller.abort()
    const value = await running
    assert.deepEqual(subagents.disposed, ['child-1'])
    assert.match(value.output, /stopped with "aborted"/)
  })
  test('an unusable catalog route falls back to the session route and says so', async () => {
    const subagents = activationRuntime([])
    const { definition } = await bootDelegate({ subagents, hostConfig: { ...BUNDLE, catalog: { routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'max' }] } } })
    const value = await definition.execute({ description: 'fallback', prompt: 'x' }, exec(modernAgent(activeSession())))
    assert.equal(subagents.started[0].request.agentOptions.provider, 'openrouter')
    assert.match(value.output, /deepseek-official\/deepseek-v4-pro is unavailable .* ran on the session's route openrouter\/flash instead/)
  })
  test('maxTaskTokens is reported as unenforced where the runtime reports no usage', async () => {
    const subagents = activationRuntime([
      { output: text('done'), stopReason: 'completed' },
      { output: [], structured: { passed: true }, stopReason: 'completed' },
    ])
    const { definition } = await bootDelegate({ subagents, delegateConfig: { provider: 'spawn', maxTaskTokens: 1000 } })
    const value = await definition.execute({ description: 'budget', prompt: 'x' }, exec(modernAgent(activeSession('frugal'))))
    assert.match(value.output, /maxTaskTokens was not enforced/)
  })
})

describe('0.1.x subagent runtime (start / startContinuable / followup)', () => {
  test('maximum mode starts children through start(provider, request)', async () => {
    const subagents = startRuntime([])
    const { definition } = await bootDelegate({ subagents })
    const session = activeSession()
    const value = await definition.execute({ description: 'legacy', tasks: ['a', 'b'] }, exec(legacyAgent(session)))
    assert.equal(value.passed, true)
    assert.equal(subagents.started.length, 2)
    assert.equal(subagents.started[0].provider, 'spawn')
    assert.equal(subagents.started[0].request.agentOptions.ultracodeEffort, 'max')
    assert.equal(subagents.started[0].request.signal !== undefined, true)
  })
  test('frugal mode keeps one continuable coder and relays findings with an ultracode source', async () => {
    let root
    const followups = []
    const subagents = {
      getProvider: () => ({ name: 'spawn', prepareContinuable() {} }),
      async start(provider, request) {
        return { id: 'validator', result: Promise.resolve({ output: [], structured: { passed: followups.length > 0 }, stopReason: 'completed' }), dispose: async () => {} }
      },
      async startContinuable({ childId }) {
        setTimeout(() => root.emit('subagent/end', { id: childId, stopReason: 'completed', lastAssistantMessage: text('first'), usage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }), 5)
      },
      async followup(_agent, childId, content, options) {
        followups.push({ childId, content, options })
        setTimeout(() => root.emit('subagent/end', { id: childId, stopReason: 'completed', lastAssistantMessage: text('second') }), 5)
      },
    }
    const booted = await bootDelegate({ subagents, extra: { agents: {}, sessionPersistence: {} } })
    root = booted.root
    const session = activeSession('frugal')
    const value = await booted.definition.execute({ description: 'shared', prompt: 'x' }, exec(legacyAgent(session)))
    assert.equal(value.passed, true)
    assert.equal(value.output, 'second')
    assert.equal(followups.length, 1)
    assert.deepEqual(followups[0].options.source, { kind: 'ultracode', form: 'relay' })
  })
})

describe('visibility and guards', () => {
  test('the tool is hidden from UltraCode-routed children and refuses them', async () => {
    const { definition, options } = await bootDelegate({ subagents: activationRuntime([]) })
    assert.equal(options.when({ agent: modernAgent(newSession()) }), true)
    assert.equal(options.when({ agent: modernAgent(newSession(), undefined, { ultracodeRole: 'coder' }) }), false)
    await assert.rejects(definition.execute({ description: 'x', prompt: 'x' }, exec(modernAgent(activeSession(), undefined, { ultracodeRole: 'coder' }))), /not available inside an UltraCode-routed subagent/)
  })
  test('an inactive session is told to switch UltraCode on, and gets no tool guidance', async () => {
    const { definition, systemPrompt } = await bootDelegate({ subagents: activationRuntime([]) })
    const session = newSession()
    await assert.rejects(definition.execute({ description: 'x', prompt: 'x' }, exec(modernAgent(session))), /UltraCode is not active/)
    const section = systemPrompt.sections.get('tool:ultracode_delegate')
    assert.equal(section.text({ agent: modernAgent(session) }), '')
    assert.match(section.text({ agent: modernAgent(activeSession()) }), /ultracode_delegate/)
    assert.equal(ultraRecords(session).length, 0, 'a refused call writes no records')
  })
  test('continuable() needs the 0.1.x continuation calls, not just a continuable provider', () => {
    const ctx = { get: () => ({}), subagents: { getProvider: () => ({ prepareContinuable() {} }) } }
    assert.equal(delegate.continuable(ctx, 'spawn'), false)
    ctx.subagents.startContinuable = () => {}
    ctx.subagents.followup = () => {}
    assert.equal(delegate.continuable(ctx, 'spawn'), true)
  })
  test('resultText keeps child text and appends the failure account', () => {
    assert.equal(delegate.resultText({ output: text('x'), stopReason: 'completed' }), 'x')
    assert.equal(delegate.resultText({ output: [], stopReason: 'completed' }), '(the subagent produced no text output)')
    assert.equal(delegate.resultText({ output: text('partial'), stopReason: 'refusal' }), 'partial\n\n[the subagent stopped with "refusal"]')
  })
})
