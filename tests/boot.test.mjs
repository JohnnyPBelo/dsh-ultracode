// Web boot safety, for both halves.
//
// A Cordis entry whose `inject` names a service nobody provides never
// activates: it sits `pending` forever. `packages/client/web/src/boot.ts` treats
// every non-active entry as a failed web boot and throws, so ONE stale service
// name aborts the whole application — not just the plugin that named it.
//
// Version 1.0.0 shipped `inject = ['conversationEvents', ...]`; 0.2.x renamed
// that registry to `uiConversation.events`, so the app refused to start with
// "web boot: 1 entry did not activate / dsh-ultracode: pending (waiting for
// service: conversationEvents)". These tests are the regression gate.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { settle } from './support/fixtures.mjs'

const STATE = ['pending', 'loading', 'active', 'failed']

/** The client half, loaded the way the browser module loader loads it. */
async function loadClient() {
  let definition
  globalThis.window = { __ModuleLoader__: { load(entry) { definition = entry } } }
  await import(`../client/client.js?boot=${String(Math.random())}`)
  delete globalThis.window
  const jsx = () => null
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: { useState: initial => [initial, () => {}] },
    '@deepseek-ai/dsh-client-ui-primitives': { StateDot: () => null },
  }
  return definition.factory(name => modules[name])
}

describe('client entry', () => {
  test('declares no service that differs between the 0.1.x and 0.2.x shells', async () => {
    const client = await loadClient()
    // Every name below exists on one API line and not the other. Naming one in
    // `inject` turns a display feature into a boot failure on the other line.
    for (const name of ['conversationEvents', 'uiConversation', 'sessions', 'connection', 'uiWorkspace']) {
      assert.ok(!client.inject.includes(name), `${name} is not available on both API lines; resolve it at the call site instead`)
    }
  })
  test('reaches ACTIVE with only slots and locale, before any conversation registry exists', async () => {
    const client = await loadClient()
    const root = new Context()
    root.provide('slots', { inject(_n, cb) { cb() }, register() { return () => {} } })
    root.provide('locale', { register() { return () => {} } })
    const fiber = root.plugin({ name: 'dsh-ultracode', inject: client.inject, apply: client.apply })
    await settle()
    assert.equal(STATE[fiber.state], 'active')
  })
})

describe('host rows', () => {
  const noop = () => () => {}
  /** Mount the services both host rows hard-require, as the base bundle does. */
  function services(root) {
    root.provide('llm', { adapters: () => [] })
    root.provide('systemPrompt', { section: noop })
    root.provide('sessionProjections', { register: () => noop() })
    root.provide('commands', { register: () => noop() })
    root.provide('tools', { register: () => noop(), get: () => undefined })
    root.provide('subagents', { getProvider: () => undefined, list: () => [] })
    root.provide('fs', {})
    root.provide('attachments', {})
  }
  test('both rows reach ACTIVE in the order the bundle patch mounts them', async () => {
    const host = await import('../lib/host.js')
    const delegate = await import('../lib/delegate.js')
    const root = new Context()
    services(root)
    const mode = root.plugin(host.default, host.Config.parse({ mode: 'maximum', catalog: { routes: [] }, section: 'x' }))
    await settle()
    assert.equal(STATE[mode.state], 'active', 'the mode row provides the `ultracode` service')
    const tool = root.plugin({ name: delegate.name, inject: delegate.inject, apply: delegate.apply, Config: delegate.Config },
      delegate.Config.parse({ provider: 'spawn' }))
    await settle()
    assert.equal(STATE[tool.state], 'active')
  })
})
