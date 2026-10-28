// Host half: config, records, folding, routing, pre-step, request, projection.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as host from '../lib/host.js'
import {
  bootHost, eventsOf, fakeCommands, fakeLlm, legacyAgent, modernAgent, newSession, preStep, settle, ultraRecords, userMessage, world,
} from './support/fixtures.mjs'

const { UltraCodeController, Config, DEFAULT_SECTION } = host
const BUNDLE_CONFIG = { mode: 'maximum', keyword: 'ultracode', reminderEveryTurns: 10 }

describe(`config (dsh-session ${world.sessionVersion})`, () => {
  test('the bundle default validates and needs no catalog or section', () => {
    const parsed = BUNDLE_CONFIG
    const resolved = host.resolveConfig(parsed)
    assert.equal(resolved.section, DEFAULT_SECTION)
    assert.deepEqual(resolved.catalog.routes, [])
  })
  test('an override that names only the catalog still loads', () => {
    const resolved = host.resolveConfig({ catalog: { routes: [{ provider: 'openrouter', model: 'flash', effort: 'max' }] } })
    assert.equal(resolved.catalog.routes.length, 1)
    assert.equal(resolved.section, DEFAULT_SECTION)
  })
  test('the controller declares its schema so the loader validates the row', () => {
    assert.equal(UltraCodeController.Config, Config)
    assert.throws(() => Config({ reminderEveryTurns: 'ten' }), /reminderEveryTurns/)
  })
  test('the schema renders a settings form, which needs toJSON and a volatile field', () => {
    assert.equal('toJSON' in Config, true)
    const volatile = Object.values(Config.toJSON().refs).filter(node => node?.meta?.volatile)
    assert.equal(volatile.length > 0, true)
  })
  test('an empty section is refused', () => {
    assert.throws(() => host.resolveConfig({ section: '   ' }), /section/)
  })
})

describe('records and folding', () => {
  test('ultraEventType normalizes both record names', () => {
    assert.equal(host.ultraEventType({ type: 'plugin:dsh-ultracode/mode' }), 'ultracode/mode')
    assert.equal(host.ultraEventType({ type: 'ultracode/task-end' }), 'ultracode/task-end')
    assert.equal(host.ultraEventType({ type: 'turn/start' }), 'turn/start')
  })
  test('foldUltraCode reads either name; the last mode record wins', () => {
    const events = [
      { type: 'ultracode/mode', data: { active: true, mode: 'frugal' } },
      { type: 'turn/start', data: {} },
      { type: 'plugin:dsh-ultracode/mode', data: { active: true, mode: 'maximum' } },
    ]
    assert.deepEqual(host.foldUltraCode(events), { active: true, mode: 'maximum' })
    assert.deepEqual(host.foldUltraCode(events, 1), { active: true, mode: 'frugal' })
    assert.deepEqual(host.foldUltraCode([], undefined, { active: false, mode: 'frugal' }), { active: false, mode: 'frugal' })
  })
  test('sessionEvents reads `events` (0.1.x) or `snapshotEvents()` (0.2.x)', () => {
    const list = [{ type: 'a' }]
    assert.equal(host.sessionEvents({ events: list }), list)
    assert.equal(host.sessionEvents({ snapshotEvents: () => list }), list)
    assert.deepEqual(host.sessionEvents({}), [])
  })
  test(`appendUltraRecord writes ${world.pluginRecords ? 'an ignorable plugin record' : 'a plain ultracode/* event'} on this runtime`, async () => {
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'maximum' })
    const [record] = ultraRecords(session)
    if (world.pluginRecords) {
      assert.equal(record.type, 'plugin:dsh-ultracode/mode')
      assert.equal(record.ignorable, true)
      const dshSession = await import('@deepseek-ai/dsh-session')
      assert.deepEqual(dshSession.pluginRecordOf(record).data, { active: true, mode: 'maximum' })
    } else {
      assert.equal(record.type, 'ultracode/mode')
    }
    assert.deepEqual(host.foldUltraCode(eventsOf(session)), { active: true, mode: 'maximum' })
  })
  test('every record kind keeps a log the session store accepts on resume', { skip: !world.pluginRecords && 'no storage contract validator on this line' }, async () => {
    const { validateStoredEvents } = await import('@deepseek-ai/dsh-session-persistence')
    const session = newSession()
    for (const kind of ['mode', 'task', 'member', 'outcome', 'task-end', 'vision-handoff']) host.appendUltraRecord(session, kind, { taskId: 't', kind })
    assert.doesNotThrow(() => validateStoredEvents(session.header, [...eventsOf(session)]))
    // The 0.1.x shape is exactly what made logs unresumable on 0.2.x:
    const legacy = newSession()
    legacy.append('ultracode/mode', { active: true, mode: 'maximum' })
    assert.throws(() => validateStoredEvents(legacy.header, [...eventsOf(legacy)]), /not marked ignorable/)
  })
  test('notices carry a producer-owned source kind and a bounded summary', () => {
    const message = host.ultraNotice('x'.repeat(300), 'y'.repeat(300))
    assert.equal(message.source.kind, 'ultracode')
    assert.notEqual(message.source.kind, 'plugin')
    assert.equal(message.source.form, 'notice')
    assert.equal(message.source.summary.length, 120)
  })
})

describe('routing', () => {
  test('pickRung takes the ends of a ladder', () => {
    assert.equal(host.pickRung(['off', 'low', 'high', 'max'], 'top'), 'max')
    assert.equal(host.pickRung(['off', 'low', 'high', 'max'], 'bottom'), 'low')
    assert.equal(host.pickRung(['low', 'medium', 'high'], 'top'), 'high')
    assert.equal(host.pickRung(['low', 'medium', 'high'], 'bottom'), 'low')
    assert.equal(host.pickRung(['fast', 'deep'], 'top'), 'deep')
    assert.equal(host.pickRung([], 'top'), undefined)
  })
  test('without a catalog every role runs on the session route (maximum: top rung)', async () => {
    const { ultracode } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const agent = modernAgent(newSession())
    const routes = ultracode.routesFor(agent)
    assert.deepEqual(routes.coder, { provider: 'openrouter', model: 'flash', rung: 'top' })
    const coder = await ultracode.childOptionsFor(agent, 'coder', new AbortController().signal)
    assert.deepEqual(coder.options, { provider: 'openrouter', model: 'flash', ultracodeRole: 'coder', reasoningEffort: 'max' })
    assert.deepEqual(coder.notes, [])
  })
  test('frugal without a catalog: coder at the lowest rung, validator at the highest', async () => {
    const { ultracode } = await bootHost(UltraCodeController, { ...BUNDLE_CONFIG, mode: 'frugal' })
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'frugal' })
    const agent = modernAgent(session)
    const signal = new AbortController().signal
    assert.equal((await ultracode.childOptionsFor(agent, 'coder', signal)).options.reasoningEffort, 'low')
    assert.equal((await ultracode.childOptionsFor(agent, 'validator', signal)).options.reasoningEffort, 'max')
  })
  test('a 0.1.x agent gets the effort as ultracodeEffort for the request rewrite', async () => {
    const { ultracode } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const coder = await ultracode.childOptionsFor(legacyAgent(newSession()), 'coder', new AbortController().signal)
    assert.equal(coder.options.ultracodeEffort, 'max')
    assert.equal(coder.options.reasoningEffort, undefined)
  })
  test('a catalog route on a provider without credentials falls back to the session route', async () => {
    const { ultracode } = await bootHost(UltraCodeController, {
      ...BUNDLE_CONFIG,
      catalog: { routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'max' }, { provider: 'nowhere', model: 'x', effort: 'low' }] },
    })
    const session = newSession()
    const agent = modernAgent(session)
    const signal = new AbortController().signal
    const coder = await ultracode.childOptionsFor(agent, 'coder', signal)
    assert.equal(coder.options.provider, 'openrouter')
    assert.equal(coder.options.model, 'flash')
    assert.equal(coder.options.reasoningEffort, 'max')
    assert.match(coder.notes[0], /deepseek-official\/deepseek-v4-pro is unavailable \(provider "deepseek-official" offers no models/)
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'frugal' })
    const frugalCoder = await ultracode.childOptionsFor(agent, 'coder', signal)
    assert.match(frugalCoder.notes[0], /provider "nowhere" is not registered/)
  })
  test('a usable catalog route is kept, with its effort validated against the model', async () => {
    const llm = fakeLlm()
    const { ultracode } = await bootHost(UltraCodeController, {
      ...BUNDLE_CONFIG,
      catalog: { routes: [{ provider: 'openrouter', model: 'flash', effort: 'max' }, { provider: 'openrouter', model: 'nemotron', effort: 'max' }] },
    }, { llm })
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'frugal' })
    const agent = modernAgent(session)
    const coder = await ultracode.childOptionsFor(agent, 'coder', new AbortController().signal)
    assert.equal(coder.options.model, 'nemotron')
    assert.equal(coder.options.reasoningEffort, undefined, 'nemotron has no "max" rung, so the adapter default applies')
    const before = llm.calls.listModels
    await ultracode.childOptionsFor(agent, 'coder', new AbortController().signal)
    assert.equal(llm.calls.listModels, before, 'preflight results are cached')
  })
  test('the policy section names the routes it will use', async () => {
    const { ultracode } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const agent = modernAgent(newSession())
    assert.match(ultracode.sectionText({ active: true, mode: 'maximum' }, agent), /Every role runs on flash at its highest reasoning effort\./)
    assert.match(ultracode.sectionText({ active: true, mode: 'frugal' }, agent), /coding runs on flash at its lowest reasoning effort; validation and testing run on flash at its highest/)
  })
})

describe('session policy on a real cordis root', () => {
  test('the keyword switches the mode on, records it, and the notice carries the policy', async () => {
    const { root, ultracode, systemPrompt } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const session = newSession()
    const agent = modernAgent(session)
    const section = systemPrompt.sections.get('ultracode:policy')
    assert.equal(section.text({ agent }), '', 'inactive sessions get no policy text')
    const decision = await preStep(root, agent, [userMessage('please ultracode this refactor')])
    assert.equal(decision.kind, 'enter')
    const notice = decision.messages.at(-1)
    assert.equal(notice.source.kind, 'ultracode')
    assert.equal(notice.source.summary, 'UltraCode is on in maximum mode.')
    assert.match(notice.content[0].text, /ultracode_delegate tool/)
    assert.deepEqual(ultracode.modeOf(session), { active: true, mode: 'maximum' })
    assert.equal(ultraRecords(session).length, 1)
    assert.match(section.text({ agent }), /UltraCode is on in maximum mode/)
    const again = await preStep(root, agent, [userMessage('ultracode again')], 1, 2)
    assert.equal(again.messages.length, 1, 'no repeated notice once the mode is in force')
    assert.equal(ultraRecords(session).length, 1)
  })
  test('a notice is never produced for an UltraCode-routed child, and a plugin notice is not a keyword', async () => {
    const { root } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const child = modernAgent(newSession(), undefined, { ultracodeRole: 'coder' })
    const decision = await preStep(root, child, [userMessage('ultracode')])
    assert.equal(decision.messages.length, 1)
    assert.equal(ultraRecords(child.session).length, 0)
    const parent = modernAgent(newSession())
    const notice = { ...userMessage('ultracode'), source: { kind: 'ultracode', form: 'notice', summary: 'ultracode' } }
    assert.equal((await preStep(root, parent, [notice])).messages.length, 1)
  })
  test('the reminder fires on the first step of every Nth turn while active', async () => {
    const { root } = await bootHost(UltraCodeController, BUNDLE_CONFIG)
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'maximum' })
    const agent = modernAgent(session)
    const due = await preStep(root, agent, [userMessage('go')], 10, 1)
    assert.equal(due.messages.at(-1).source.kind, 'ultracode')
    assert.ok(due.messages.at(-1).source.summary.length <= 120)
    assert.equal((await preStep(root, agent, [userMessage('go')], 10, 2)).messages.length, 1)
    assert.equal((await preStep(root, agent, [userMessage('go')], 11, 1)).messages.length, 1)
  })
  test('/ultracode queues a selection that the next step commits', async () => {
    const commands = fakeCommands()
    const { root, ultracode } = await bootHost(UltraCodeController, BUNDLE_CONFIG, { commands })
    const session = newSession()
    const agent = modernAgent(session)
    const command = commands.registered.get('ultracode')
    assert.match(command.handler({ agent, rawInput: 'frugal' }).text, /UltraCode on \(frugal\)/)
    assert.equal(command.handler({ agent, rawInput: 'bogus' }).kind, 'error')
    const decision = await preStep(root, agent, [userMessage('hello')])
    assert.equal(decision.messages.at(-1).source.summary, 'UltraCode is on in frugal mode.')
    assert.deepEqual(ultracode.modeOf(session), { active: true, mode: 'frugal' })
    assert.equal(command.handler({ agent, rawInput: 'frugal' }).text, 'UltraCode already runs frugal.')
  })
  test('agent/request: 0.2.x selections are never rewritten; 0.1.x requests get the route effort', async () => {
    const { root } = await bootHost(UltraCodeController, { ...BUNDLE_CONFIG, catalog: { routes: [{ provider: 'openrouter', model: 'flash', effort: 'max' }] } })
    const base = { provider: 'openrouter', model: 'flash', reasoningEffort: 'low' }
    const request = agent => root.waterfall('agent/request', { agent, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ ...base }))
    const modernChild = modernAgent(newSession(), undefined, { ultracodeRole: 'coder', ultracodeEffort: 'max' })
    assert.deepEqual(await request(modernChild), base)
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'maximum' })
    assert.deepEqual(await request(modernAgent(session)), base)
    const legacyChild = legacyAgent(newSession(), undefined, { ultracodeRole: 'coder', ultracodeEffort: 'max' })
    assert.equal((await request(legacyChild)).reasoningEffort, 'max')
    assert.equal((await request(legacyAgent(session))).reasoningEffort, 'max')
  })
})

describe(`projection on the runtime's registry (dsh-session ${world.sessionVersion})`, () => {
  test('registers, folds both record names, restores from a checkpoint, and serves a client value', async () => {
    const { SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection')
    const { Context } = await import('@deepseek-ai/cordis')
    const root = new Context()
    root.provide('llm', fakeLlm())
    root.provide('systemPrompt', { section() {} })
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(UltraCodeController, BUNDLE_CONFIG)
    await settle()
    const ultracode = root.get('ultracode')
    const session = newSession()
    host.appendUltraRecord(session, 'mode', { active: true, mode: 'frugal' })
    assert.deepEqual(ultracode.modeOf(session), { active: true, mode: 'frugal' })
    const registry = root.get('sessionProjections')
    const state = { active: true, mode: 'frugal', wanted: null, running: null }
    const turn = { type: 'turn/start', seq: 3, time: 0, data: { turn: 2 } }
    if (world.pluginRecords) {
      assert.ok(ultracode.projection !== undefined, '0.2.x hands back a projection handle')
      assert.deepEqual(ultracode.projection.stateOf(session).mode, 'frugal')
      const restored = registry.restore({ ultracode: { ver: 1, seq: 2, val: state } }, [turn], 3, session.header, 0)
      assert.deepEqual(restored.snapshot.values.ultracode, { active: true, mode: 'frugal', pending: false })
      assert.deepEqual(registry.viewCheckpoint({ ultracode: { ver: 1, seq: 2, val: state } }).ultracode, { active: true, mode: 'frugal', pending: false })
    } else {
      assert.equal(ultracode.projection, undefined, '0.1.x registry returns a disposer, not a handle')
      assert.deepEqual(registry.snapshot(session).values.ultracode, { active: true, mode: 'frugal', pending: false })
      const restored = registry.restore({ ultracode: { ver: 1, seq: 2, val: state } }, [turn], 3)
      assert.deepEqual(restored.snapshot.values.ultracode, { active: true, mode: 'frugal', pending: false })
    }
  })
})
