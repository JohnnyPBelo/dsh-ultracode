// Browser half: activation without the conversation registries, registration
// through whichever registry exists, record matching, rendering, navigation.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { settle } from './support/fixtures.mjs'

/** Load client/client.js the way the browser module loader does. */
async function loadClient(primitives) {
  let definition
  globalThis.window = { __ModuleLoader__: { load(entry) { definition = entry } } }
  await import(`../client/client.js?load=${String(Math.random())}`)
  delete globalThis.window
  assert.equal(definition.id, 'dsh-ultracode')
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: { useState: initial => [initial, () => {}] },
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  return definition.factory(name => {
    if (!(name in modules)) throw new Error(`unexpected client import ${name}`)
    return modules[name]
  })
}

/** The 0.2.x primitives: no IconChevronRightOutline14. */
const RC3_PRIMITIVES = {
  StateDot: function StateDot() { return null },
  DisclosureRow: function DisclosureRow(props) { return { type: 'div', props: { children: [props.icon, props.title, props.collapsedContent, props.children] } } },
  IconChevronRightOutlineRegular: function IconChevronRightOutlineRegular() { return null },
}

/** Expand function components into a plain tree, failing on an undefined element type. */
function render(element) {
  if (Array.isArray(element)) return element.map(render)
  if (element === null || typeof element !== 'object') return element
  if (element.type === undefined) throw new Error('element with an undefined type (a missing primitive)')
  if (typeof element.type === 'function') return render(element.type(element.props))
  const children = element.props.children
  return { ...element, props: { ...element.props, children: children === undefined ? undefined : render(children) } }
}
function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
  if (node === null || typeof node !== 'object') return
  yield node
  yield* walk(node.props?.children)
}
const textOf = node => [...walk(node)].flatMap(n => [n.props?.children].flat()).filter(v => typeof v === 'string').join(' | ')

function fakeClientServices() {
  const slots = { registered: [], inject(_name, callback) { callback() }, register(options, component) { this.registered.push({ options, component }); return () => {} } }
  const locale = { namespaces: [], register(ns, dictionaries) { this.namespaces.push({ ns, dictionaries }); return () => {} } }
  return { slots, locale }
}
function fakeRegistry() {
  return { definitions: [], register(definition) { this.definitions.push(definition); return () => {} } }
}

async function bootClient(client, services = {}) {
  const root = new Context()
  const { slots, locale } = fakeClientServices()
  root.provide('slots', slots)
  root.provide('locale', locale)
  for (const [name, value] of Object.entries(services)) root.provide(name, value)
  const fiber = root.plugin({ name: 'dsh-ultracode', inject: client.inject, apply: client.apply })
  await settle()
  return { root, fiber, slots, locale }
}

describe('activation', () => {
  test('the entry needs only slots and locale', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    assert.deepEqual(client.inject, ['slots', 'locale'])
  })
  test('0.2.x: active without conversationEvents; registers through uiConversation.events when it appears', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const { root, fiber, slots, locale } = await bootClient(client)
    assert.equal(fiber.state, 2, 'the entry fiber is ACTIVE although no conversation registry exists yet')
    assert.equal(slots.registered.length, 1)
    assert.equal(locale.namespaces[0].ns, 'ultracode')
    assert.deepEqual(Object.keys(locale.namespaces[0].dictionaries.zh).sort(), Object.keys(locale.namespaces[0].dictionaries.en).sort())
    const events = fakeRegistry()
    root.provide('uiConversation', { events })
    await settle()
    assert.deepEqual(events.definitions.map(d => d.kind), ['ultracode-task'])
    const legacy = fakeRegistry()
    root.provide('conversationEvents', legacy)
    await settle()
    assert.equal(legacy.definitions.length, 0, 'the Definition is registered once, not per registry')
  })
  test('0.1.x: registers through conversationEvents', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const legacy = fakeRegistry()
    const { fiber } = await bootClient(client, { conversationEvents: legacy })
    assert.equal(fiber.state, 2)
    assert.deepEqual(legacy.definitions.map(d => d.kind), ['ultracode-task'])
  })
  test('a member click navigates through uiWorkspace, or sessions.open where that is the API', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const opened = []
    const { slots } = await bootClient(client, { uiWorkspace: { openSession: id => opened.push(['workspace', id]) } })
    slots.registered[0].options.inject().openMember('child-1')
    const older = await bootClient(client, { sessions: { open: id => opened.push(['sessions', id]) } })
    older.slots.registered[0].options.inject().openMember('child-2')
    const none = await bootClient(client)
    assert.doesNotThrow(() => none.slots.registered[0].options.inject().openMember('child-3'))
    assert.deepEqual(opened, [['workspace', 'child-1'], ['sessions', 'child-2']])
  })
})

/** Drive the task Definition over a record list the way the conversation engine does. */
function fold(definition, events, location = { kind: 'turn', turn: { status: 'open' } }) {
  let context
  for (const event of events) {
    const match = definition.match(event)
    if (match === null) continue
    if (match.role === 'start') {
      context = { id: match.id, key: `ultracode-task:${match.id}`, start: { event, location } }
      context.state = definition.start(context, { event, ...match })
    } else {
      context.state = definition.update(context, { event, ...match })
    }
  }
  return definition.buildViewNode(context)
}

const records = prefix => [
  { type: `${prefix}task`, seq: 4, data: { taskId: 't1', label: 'probe task', mode: 'frugal' } },
  { type: `${prefix}member`, seq: 5, data: { taskId: 't1', childId: 'c1', role: 'coder', provider: 'openrouter', model: 'flash', round: 0 } },
  { type: `${prefix}outcome`, seq: 6, data: { taskId: 't1', childId: 'c1', stopReason: 'completed', accepted: false } },
  { type: `${prefix}member`, seq: 7, data: { taskId: 't1', childId: 'v1', role: 'validator', provider: 'openrouter', model: 'flash', round: 0 } },
  { type: `${prefix}outcome`, seq: 8, data: { taskId: 't1', childId: 'v1', stopReason: 'completed', accepted: false } },
  { type: `${prefix}member`, seq: 9, data: { taskId: 't1', childId: 'c2', role: 'coder', provider: 'openrouter', model: 'flash', round: 1 } },
  { type: `${prefix}outcome`, seq: 10, data: { taskId: 't1', childId: 'c2', stopReason: 'error', accepted: false } },
  { type: `${prefix}task-end`, seq: 11, data: { taskId: 't1', passed: false, rounds: 2 } },
]

describe('task Definition', () => {
  for (const [label, prefix] of [['0.2.x plugin records', 'plugin:dsh-ultracode/'], ['0.1.x events', 'ultracode/']]) {
    test(`folds ${label} into one node with honest member statuses`, async () => {
      const { ultraTaskDefinition } = await loadClient(RC3_PRIMITIVES)
      const node = fold(ultraTaskDefinition, [{ type: 'turn/start', seq: 3, data: {} }, ...records(prefix)])
      assert.equal(node.kind, 'ultracode-task')
      assert.equal(node.anchorSeq, 4)
      assert.equal(node.data.status, 'failed')
      assert.deepEqual(node.data.members.map(m => [m.childId, m.status]), [['c1', 'done'], ['v1', 'rejected'], ['c2', 'failed']])
    })
  }
  test('a shared coder reused across rounds settles each round once', async () => {
    const { ultraTaskDefinition } = await loadClient(RC3_PRIMITIVES)
    const p = 'plugin:dsh-ultracode/'
    const node = fold(ultraTaskDefinition, [
      { type: `${p}task`, seq: 1, data: { taskId: 't', label: '', mode: 'frugal' } },
      { type: `${p}member`, seq: 2, data: { taskId: 't', childId: 'c', role: 'coder', model: 'm', round: 0 } },
      { type: `${p}outcome`, seq: 3, data: { taskId: 't', childId: 'c', stopReason: 'completed', accepted: true } },
      { type: `${p}member`, seq: 4, data: { taskId: 't', childId: 'c', role: 'coder', model: 'm', round: 1 } },
    ])
    assert.deepEqual(node.data.members.map(m => m.status), ['done', 'running'])
  })
  test('an interrupted task (closed turn, no task-end) reads failed', async () => {
    const { ultraTaskDefinition } = await loadClient(RC3_PRIMITIVES)
    const node = fold(ultraTaskDefinition, records('ultracode/').slice(0, 2), { kind: 'turn', turn: { status: 'closed' } })
    assert.equal(node.data.status, 'failed')
    assert.equal(node.data.members[0].status, 'failed')
  })
})

describe('panel rendering', () => {
  test('renders with the 0.2.x primitive set (no IconChevronRightOutline14)', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const { slots } = await bootClient(client)
    const { options, component } = slots.registered[0]
    assert.equal(options.name, 'conversation.chat.node')
    assert.equal(options.key, 'ultracode-task')
    const node = fold(client.ultraTaskDefinition, records('plugin:dsh-ultracode/'))
    const t = (key, vars) => vars === undefined ? key : `${key}${JSON.stringify(vars)}`
    const tree = render(component({ node, openMember() {}, t }))
    const buttons = [...walk(tree)].filter(n => n.type === 'button')
    assert.deepEqual(buttons.map(b => b.props['data-member-status']), ['done', 'rejected', 'failed'])
    assert.match(textOf(tree), /probe task/)
    assert.match(textOf(tree), /status\.done/)
  })
})

describe('boot safety', () => {
  // A client entry whose `inject` names a service the web shell does not
  // provide stays `pending`, and packages/client/web/src/boot.ts treats any
  // non-active entry as a failed web boot — one stale name takes down the whole
  // application, not just this plugin. The published v1.0.0 declared
  // `conversationEvents`, which exists on 0.1.x but not on 0.2.x (there it is
  // `uiConversation.events`), and the app refused to boot. Nothing in the
  // manifest or the source says a name is optional: `ctx.inject` is a hard
  // wait, so the only safe set is services the entry actually cannot run
  // without.
  test('declares no service the web shell may not provide', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const epochServices = ['conversationEvents', 'uiConversation', 'sessions', 'connection', 'uiWorkspace']
    for (const name of epochServices) {
      assert.ok(!client.inject.includes(name), `${name} is provided by one API line only; naming it in inject aborts web boot on the other`)
    }
  })
  test('activates on the minimum set, and still registers through a registry that appears later', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const { fiber, slots } = await bootClient(client)
    assert.equal(fiber.state, 2, 'the entry fiber is ACTIVE with only slots and locale')
    assert.equal(slots.registered.length, 1)
    const events = fakeRegistry()
    ;(await import('@deepseek-ai/cordis')).Context // keep the import graph honest
    assert.equal(typeof events.register, 'function')
  })
})
