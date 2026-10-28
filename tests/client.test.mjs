// Browser half: activation without the conversation registries, registration
// through whichever registry exists, record matching, rendering, navigation.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { settle } from './support/fixtures.mjs'

/**
 * A small hook runtime: `useState` keeps a slot per position, `useEffect` queues
 * its callback so a test can flush it and render again.
 */
function createHooks() {
  let slots = []
  let index = 0
  let queued = []
  const hooks = {
    useState(initial) {
      const at = index++
      if (!(at in slots)) slots[at] = initial
      return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next }]
    },
    useEffect(callback) { queued.push(callback) },
    // The card memoizes its snapshot reader so the store subscription is stable
    // across the summary and page renders of the same entry.
    useCallback(fn) { return fn },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    /** Render one component, flush its effects, render again, and return the tree. */
    async render(element) {
      index = 0
      const first = render(element)
      index = 0
      for (const callback of queued.splice(0)) callback()
      await settle()
      index = 0
      void first
      return render(element)
    },
    reset() { slots = []; index = 0; queued = [] },
  }
  return hooks
}

/** Load client/client.js the way the browser module loader does. */
async function loadClient(primitives, hooks = createHooks()) {
  let definition
  globalThis.window = { __ModuleLoader__: { load(entry) { definition = entry } } }
  await import(`../client/client.js?load=${String(Math.random())}`)
  delete globalThis.window
  assert.equal(definition.id, 'dsh-ultracode')
  hooks.reset()
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: hooks,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  const client = definition.factory(name => {
    if (!(name in modules)) throw new Error(`unexpected client import ${name}`)
    return modules[name]
  })
  client.hooks = hooks
  return client
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
  const locale = { namespaces: [], register(ns, dictionaries) { this.namespaces.push({ ns, dictionaries }); return () => {} }, bind: ns => key => `${ns}:${key}`, translate: (ns, key) => `${ns}:${key}` }
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

/**
* The two schema envelopes the Host actually serves, built the way
* `Config.toJSON()` builds them: one `refs` table addressed by NUMERIC ids, a
* root object node whose `dict` maps each member name to its id, a `union` of
* `const` members for closed choices, and — the detail a flattened fixture gets
* wrong — an `array`'s `inner` and an `object`'s `dict` values are IDS too, not
* inlined nodes. Rendering therefore resolves every child through `nodeAt`, and a
* fixture with inline nodes would exercise a path the real shell never takes.
*/
function envelope(rootDict, extra = {}) {
  // Every node lives in ONE table and every reference is an id, so the root's
  // members are registered here rather than inlined: a `dict` of inline nodes is
  // not a shape the Host ever sends.
  const refs = { ...extra }
  let next = 1000
  const dict = {}
  for (const [key, node] of Object.entries(rootDict)) {
    refs[next] = node
    dict[key] = next
    next += 1
  }
  refs[0] = { type: 'object', meta: { default: {} }, dict }
  return { uid: 0, refs }
}
const SERVED = (() => {
  const ROUTE = 90
  const TEXT = 91
  const MAXIMUM = 92
  const FRUGAL = 93
  const routeDict = { provider: TEXT, model: TEXT, effort: TEXT }
  const hostSchema = envelope(
    {
      mode: { type: 'union', meta: {}, list: [MAXIMUM, FRUGAL] },
      catalog: { type: 'array', meta: { default: [] }, inner: ROUTE },
      roles: { type: 'object', meta: { default: {} }, dict: { coder: ROUTE, validator: ROUTE, vision: ROUTE } },
      keyword: { type: 'string', meta: { min: 1 } },
      reminderEveryTurns: { type: 'number', meta: { step: 1, min: 0, max: 1024 } },
      section: { type: 'string', meta: {} },
    },
    {
      [ROUTE]: { type: 'object', meta: { default: {} }, dict: routeDict },
      [TEXT]: { type: 'string', meta: { min: 1 } },
      [MAXIMUM]: { type: 'const', meta: { required: true }, value: 'maximum' },
      [FRUGAL]: { type: 'const', meta: { required: true }, value: 'frugal' },
    },
  )
  const delegateSchema = envelope({
    provider: { type: 'string', meta: { min: 1 } },
    toolName: { type: 'string', meta: { min: 1 } },
    maxValidationRounds: { type: 'number', meta: { step: 1, min: 0, max: 64 } },
    maxTaskTokens: { type: 'number', meta: { step: 1, min: 1 } },
    maxConcurrentMembers: { type: 'number', meta: { step: 1, min: 0, max: 64 } },
    maxTransientRetries: { type: 'number', meta: { step: 1, min: 0, max: 10 } },
    retryBackoffMs: { type: 'number', meta: { step: 1, min: 0, max: 60000 } },
  })
  return [
    { ns: 'ultracode', value: { mode: 'frugal' }, base: {}, user: {}, revision: 0, schema: hostSchema },
    { ns: 'tool-ultracode-delegate', value: { maxValidationRounds: 3 }, base: {}, user: {}, revision: 0, schema: delegateSchema },
  ]
})()

describe('settings page', () => {
  /** A form controller stand-in: one stored value, one subscriber list. */
  function fakeForm(value, writable = true) {
    const listeners = new Set()
    const writes = []
    return {
      writes,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      getSnapshot() { return { status: 'ready', writable, value } },
      set(field, next) { writes.push([field, next]); value = { ...value, [field]: next }; for (const l of listeners) l() },
      unset(field) { writes.push([field, undefined]); value = { ...value, [field]: undefined }; for (const l of listeners) l() },
      mutate(ops) {
        // The page writes nested members, so a `set` op carries one path segment
        // per part; a single-key write would store "roles.coder" literally.
        for (const op of ops) {
          const path = Array.isArray(op.path) ? op.path : [op.path]
          writes.push([path.join('.'), op.value])
          if (path.length === 1) value = { ...value, [path[0]]: op.value }
        }
        for (const l of listeners) l()
        return Promise.resolve(true)
      },
    }
  }

  const CATALOG = {
    default: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    groups: [
      { id: 'deepseek-official', label: 'DeepSeek', models: [
        { id: 'deepseek-v4-pro', label: 'V4 Pro', reasoning: { efforts: ['off', 'low', 'high', 'max'] } },
        { id: 'deepseek-v4-flash', label: 'V4 Flash', reasoning: { efforts: ['off', 'low', 'high', 'max'] } },
      ] },
      { id: 'nvidia', label: 'NVIDIA', models: [
        { id: 'qwen3-max', label: 'Qwen3 Max', reasoning: { efforts: [] } },
      ] },
    ],
  }

  test('routeOptions offers one provider per catalog group and only its own rungs', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const options = client.routeOptions(CATALOG)
    assert.deepEqual(options.providers.map(p => p.value), ['deepseek-official', 'nvidia'])
    assert.deepEqual(options.models.get('deepseek-official').map(m => m.value), ['deepseek-v4-pro', 'deepseek-v4-flash'])
    assert.deepEqual(options.effortsFor('deepseek-official', 'deepseek-v4-pro'), ['off', 'low', 'high', 'max'])
    // A model whose adapter declares no rungs offers none, so an unacceptable
    // value cannot be selected.
    assert.deepEqual(options.effortsFor('nvidia', 'qwen3-max'), [])
    assert.deepEqual(options.effortsFor(undefined, undefined), [])
  })

  test('the page renders every dropdown with the stored value selected', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({
      mode: 'frugal',
      catalog: { routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'max' }] },
      roles: { coder: { provider: 'deepseek-official', model: 'deepseek-v4-flash', effort: 'low' } },
      keyword: 'ultracode',
      reminderEveryTurns: 10,
      section: '',
    })
    const tree = await client.hooks.render({ type: client.UltraCodeSettings, props: {
      settingsForm: form,
      schema: SERVED[0].schema,
      loadCatalog: () => Promise.resolve({ ok: true, value: CATALOG }),
      t: key => key,
    } })
    const select = [...walk(tree)].filter(n => n.type === 'select')
    // mode, then per catalog route (provider/model/effort), then the three roles.
    assert.ok(select.length >= 7, `expected the mode, route and role selects, got ${String(select.length)}`)
    const values = select.map(node => node.props.value)
    assert.ok(values.includes('frugal'), 'the stored mode is selected')
    assert.ok(values.includes('deepseek-v4-pro'), 'the catalog route model is selected')
    // The effort select offers exactly the rungs the model's adapter declares:
    // a rung the adapter would reject cannot be picked.
    const effortSelect = [...walk(tree)].find(n => n.type === 'select' && n.props.value === 'max')
    assert.ok(effortSelect !== undefined, 'the route effort select is selected on its stored rung')
    const rungs = [...walk(effortSelect)].filter(n => n.type === 'option').map(n => n.props.value)
    assert.deepEqual(rungs, ['', 'off', 'low', 'high', 'max'], 'the empty option is the default rung')
  })

  test('choosing a provider writes it and clears the stale model', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({ mode: 'maximum', catalog: { routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }] } })
    const tree = render({ type: client.UltraCodeSettings, props: {
      settingsForm: form,
      schema: SERVED[0].schema,
      loadCatalog: () => Promise.resolve({ ok: true, value: CATALOG }),
      t: key => key,
    } })
    const providerSelect = [...walk(tree)].find(n => n.type === 'select' && n.props.value === 'deepseek-official')
    assert.ok(providerSelect !== undefined, 'the provider select rendered')
    providerSelect.props.onChange({ target: { value: 'nvidia' } })
    await settle()
    // Picking a provider clears the model, because the previous model belongs to
    // the provider that was just replaced.
    const [, written] = form.writes.at(-1)
    assert.equal(written.routes[0].provider, 'nvidia')
    assert.equal(written.routes[0].model, undefined)
  })

  test('a read-only form disables every control', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({ mode: 'maximum' }, false)
    const tree = await client.hooks.render({ type: client.UltraCodeSettings, props: { settingsForm: form, schema: SERVED[0].schema, loadCatalog: () => Promise.resolve({ ok: true, value: CATALOG }), t: key => key } })
    for (const node of walk(tree)) {
      if (node.type === 'select' || node.type === 'input' || node.type === 'textarea') assert.equal(node.props.disabled, true)
    }
  })

  test('the page answers the summary view without a form and survives a missing one', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    // The Plugins page renders this entry twice: a one-liner under the row title
    // (no form) and the page body (with one). Reading the controller
    // unconditionally crashed the first render and the error boundary blacked
    // the whole page out.
    const summary = await client.hooks.render({ type: client.UltraCodeSettings, props: { view: 'summary', t: key => key } })
    // A summary render returns the dictionary line as a bare string, not an
    // element tree, so it must be read directly rather than walked.
    assert.equal(String(summary), 'settings.summary', 'the one-liner is the dictionary line, not a crash')
    const noForm = await client.hooks.render({ type: client.UltraCodeSettings, props: { t: key => key } })
    // A settings write re-edits the Loader entry and restarts the plugin, which
    // briefly leaves the mirror without this namespace. That transient must
    // render its own message: returning nothing blanked the page for good,
    // because the render that would have re-read the form never happened.
    const nodes = [...walk(noForm)]
    assert.equal(nodes.length, 1, 'a page render without a form still renders its unavailable notice')
    assert.equal(nodes[0].type, 'p', 'the unavailable notice is a paragraph')
    assert.equal(nodes[0].props.children, 'settings.unavailable', 'the notice is the dictionary line')
  })

  test('a namespace that is momentarily unavailable renders its notice instead of nothing', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    // While a write re-edits the Loader entry the mirror drops this namespace,
    // so the controller reports `unavailable`. Rendering nothing there left the
    // page blank permanently: the snapshot that would restore the form arrives
    // with the next mirror update, but no render is scheduled from a null.
    const form = {
      subscribe: () => () => {},
      getSnapshot: () => ({ status: 'unavailable', writable: true, value: undefined }),
      mutate: () => Promise.resolve(true),
    }
    const tree = await client.hooks.render({ type: client.UltraCodeSettings, props: { settingsForm: form, schema: SERVED[0].schema, t: key => key } })
    const nodes = [...walk(tree)]
    assert.equal(nodes.length, 1, 'the unavailable state renders one notice')
    assert.equal(nodes[0].props.children, 'settings.unavailable', 'the notice is the dictionary line')
  })

  test('the page mounts through configForms and reports the namespace', async () => {
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({ mode: 'maximum' })
    // A row's configuration is keyed by `<package>#<row id>`, with the row ids the
    // bundle's own patch declares: the Plugins page gives each of those rows a
    // configure control that opens the entry's page.
    const asked = []
    // The page renders the SERVED schema, so the fixture mirrors the Host's
    // describe() view: one envelope per namespace, each with its own root node.
    const configForms = {
      get: ns => { asked.push(ns); return form },
      describe: () => ({ getSnapshot: () => ({ view: { writable: true, namespaces: SERVED } }) }),
    }
    // `remote` and `remote.session` are separate declared services: the entry's
    // scoped inject names both, and a test fixture must serve both by those exact
    // names so the same declaration is exercised here as in the real shell.
    const services = { configForms }
    services['remote'] = { session: { modelCatalog: () => Promise.resolve({ ok: true, value: CATALOG }) } }
    services['remote.session'] = services['remote'].session
    const { slots, fiber } = await bootClient(client, services)
    await settle()
    assert.equal(fiber.state, 2, 'the entry stays ACTIVE with the settings service present')
    const pages = slots.registered.filter(entry => entry.options.name === 'plugins.row.config')
    assert.deepEqual(pages.map(entry => entry.options.key), ['dsh-ultracode#ultracode', 'dsh-ultracode#tool-ultracode-delegate'],
      'both rows the bundle declares are configurable')
    const injected = pages[0].options.inject()
    assert.equal(injected.settingsForm, form)
    assert.deepEqual(asked, ['ultracode'], 'the mode row reads the mode namespace')
    assert.equal(injected.t('settings.nav'), 'ultracode:settings.nav')
    pages[1].options.inject()
    assert.deepEqual(asked, ['ultracode', 'tool-ultracode-delegate'], 'the delegation row reads its own namespace')
  })

  test('each row renders ITS OWN fields, not the other row\'s', async () => {
    // The two rows this bundle mounts have disjoint Configs. Rendering a fixed
    // field list showed the mode row's controls under the delegation row's title,
    // so the page is driven by the SERVED schema: the delegation row must show its
    // six fields and none of the mode row's.
    const client = await loadClient(RC3_PRIMITIVES)
    const select = async (schema, value) => {
      const tree = await client.hooks.render({ type: client.UltraCodeSettings, props: {
        settingsForm: fakeForm(value),
        schema,
        loadCatalog: () => Promise.resolve({ ok: true, value: CATALOG }),
        t: key => key,
      } })
      return [...walk(tree)].filter(n => n.type === 'label').map(n => textOf(n.props.children))
    }
    const delegation = (await select(SERVED[1].schema, { maxValidationRounds: 3 })).join('\n')
    assert.ok(delegation.includes('settings.field.maxValidationRounds'), 'the delegation row renders its own validation-rounds field')
    assert.ok(delegation.includes('settings.field.retryBackoffMs'), 'and its retry backoff field')
    assert.ok(!delegation.includes('settings.field.mode'), 'the delegation row never renders the mode row\'s cost-mode field')
    assert.ok(!delegation.includes('settings.field.keyword'), 'nor its activation keyword')
    const mode = (await select(SERVED[0].schema, { mode: 'frugal' })).join('\n')
    assert.ok(mode.includes('settings.field.mode'), 'the mode row renders its cost-mode field')
    assert.ok(!mode.includes('settings.field.maxValidationRounds'), 'the mode row never renders the delegation row\'s fields')
  })

  test('a nested field is written with one path segment per part', async () => {
    // `set(field, value)` sends a SINGLE-segment path, so a nested write through it
    // would store a field literally named "roles.coder" that no reader looks at.
    // The page therefore mutates with the dotted path split into segments.
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({ roles: { coder: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }, catalog: { routes: [] }, mode: 'maximum' })
    const writes = []
    form.mutate = ops => { writes.push(ops); return Promise.resolve(true) }
    const tree = render({ type: client.UltraCodeSettings, props: {
      settingsForm: form,
      schema: SERVED[0].schema,
      loadCatalog: () => Promise.resolve({ ok: true, value: CATALOG }),
      t: key => key,
    } })
    const coderProvider = [...walk(tree)].find(n => n.type === 'select' && n.props.value === 'deepseek-official')
    assert.ok(coderProvider !== undefined, 'the coder provider select rendered')
    coderProvider.props.onChange({ target: { value: 'nvidia' } })
    await settle()
    const last = writes.at(-1)
    assert.deepEqual(last[0].path, ['roles', 'coder'], 'the role write addresses the nested member, not one literal key')
    assert.equal(last[0].op, 'set')
    assert.equal(last[0].value.provider, 'nvidia')
  })

  test('a field with no dictionary entry still renders under its own name', async () => {
    // The page is schema-driven, so a field added to a Config after the client
    // shipped must still appear rather than vanish: the label falls back to the
    // raw dotted path.
    const client = await loadClient(RC3_PRIMITIVES)
    const schema = envelope({ brandNewField: { type: 'string', meta: { min: 1 } } })
    const tree = await client.hooks.render({ type: client.UltraCodeSettings, props: {
      settingsForm: fakeForm({ brandNewField: 'x' }),
      schema,
      t: key => key,
    } })
    const labels = [...walk(tree)].filter(n => n.type === 'label').map(n => textOf(n.props.children))
    assert.ok(labels.includes('settings.field.brandNewField'), 'the unknown field renders under its own path')
  })

  test('the settings scope declares the nested remote.session service by name', async () => {
    // Reaching `remote.session` through the `remote` property does not inherit the
    // declaration: a nested service has to be named separately, and an undeclared
    // read throws `cannot get property ... without inject`, which the slot
    // boundary turns into a page that never appears. The declaration is therefore
    // pinned directly — a plain fixture object cannot reproduce the throw, so
    // serving both names would still pass while the real shell broke.
    const client = await loadClient(RC3_PRIMITIVES)
    const form = fakeForm({ mode: 'maximum' })
    const session = { modelCatalog: () => Promise.resolve({ ok: true, value: CATALOG }) }
    const declared = []
    const services = { configForms: { get: () => form, describe: () => ({ getSnapshot: () => ({ view: { writable: true, namespaces: SERVED } }) }) }, remote: { session }, 'remote.session': session }
    const root = new Context()
    const { slots, locale } = fakeClientServices()
    root.provide('slots', slots)
    root.provide('locale', locale)
    for (const [name, value] of Object.entries(services)) root.provide(name, value)
    const inject = root.inject.bind(root)
    root.inject = (names, callback) => { declared.push(...names); return inject(names, callback) }
    const fiber = root.plugin({ name: 'dsh-ultracode', inject: client.inject, apply: client.apply })
    await settle()
    assert.equal(fiber.state, 2)
    assert.ok(declared.includes('remote'), 'the page reads the remote root')
    assert.ok(declared.includes('remote.session'), 'the nested catalog service is named, not inherited')
    const page = slots.registered.find(entry => entry.options.name === 'plugins.row.config')
    assert.equal((await page.options.inject().loadCatalog()).ok, true)
  })
})
