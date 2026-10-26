// Shared fixtures: the runtime under test, real Sessions from it, and fake
// harness services shaped like either API line.
import { Context } from '@deepseek-ai/cordis'
import * as dshSession from '@deepseek-ai/dsh-session'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const runtime = process.env.DSH_RUNTIME_NODE_MODULES

/** Facts about the runtime this process resolves against. */
export const world = {
  root: runtime,
  sessionVersion: JSON.parse(readFileSync(join(runtime, '@deepseek-ai/dsh-session/package.json'), 'utf8')).version,
  /** 0.2.x: ignorable plugin records, no `session.events`. */
  pluginRecords: typeof dshSession.appendPluginRecord === 'function',
}

/** CommonJS-style require rooted at the runtime, for helper packages (semver, yaml). */
export const runtimeRequire = createRequire(join(runtime, '__dsh_ultracode_test_anchor__.js'))

let sessions = 0
/** A real detached Session from the runtime under test. */
export function newSession() {
  sessions++
  return dshSession.Session.create(dshSession.SessionId(`session-ultracode-test-${String(sessions)}-${String(process.pid)}`))
}

/** A session's events on either line. */
export function eventsOf(session) {
  return session.events ?? session.snapshotEvents()
}

/** UltraCode records in a session, with their raw types. */
export function ultraRecords(session) {
  return eventsOf(session).filter(event => typeof event.type === 'string' && /^(plugin:dsh-)?ultracode\//.test(event.type))
}

/** The ladder the fixtures' fake model declares. */
export const FLASH_EFFORTS = ['off', 'low', 'high', 'max']

/**
 * A fake LLM runtime: provider `openrouter` serves `flash` (text+image, the
 * FLASH ladder) and `nemotron` (text, low/medium/high); provider
 * `deepseek-official` is registered but lists no models (no API key).
 */
export function fakeLlm() {
  const models = {
    'openrouter/flash': { efforts: FLASH_EFFORTS, input: ['text', 'image'] },
    'openrouter/nemotron': { efforts: ['low', 'medium', 'high'], input: ['text'] },
    'deepseek-official/deepseek-v4-pro': { efforts: ['high', 'max'], input: ['text'] },
  }
  const calls = { listModels: 0, resolveModelInfo: 0 }
  return {
    calls,
    listProviders: () => [{ id: 'openrouter', name: 'OpenRouter' }, { id: 'deepseek-official', name: 'DeepSeek' }],
    async listModels(provider) {
      calls.listModels++
      return provider === 'openrouter' ? [{ provider, id: 'flash', name: 'flash' }, { provider, id: 'nemotron', name: 'nemotron' }] : []
    },
    async resolveModelInfo(provider, model) {
      calls.resolveModelInfo++
      const known = models[`${provider}/${model}`]
      if (known === undefined) throw Object.assign(new Error(`unknown model ${provider}/${model}`), { code: 'UNKNOWN_MODEL' })
      return {
        provider,
        id: model,
        name: model,
        inputModalities: known.input,
        reasoning: { efforts: known.efforts.map(id => ({ id, name: id })) },
      }
    },
  }
}

/** A fake system-prompt service that records sections. */
export function fakeSystemPrompt() {
  const sections = new Map()
  return { sections, section(definition) { sections.set(definition.name, definition) } }
}

/** A fake command registry. */
export function fakeCommands() {
  const registered = new Map()
  return { registered, register(definition) { registered.set(definition.name, definition) } }
}

/**
 * A session owner shaped like a 0.2.x Agent: `model.current()`/`model.select()`.
 * @param session - its real Session.
 * @param route - the selection it runs on.
 */
export function modernAgent(session, route = { provider: 'openrouter', model: 'flash', reasoningEffort: 'max' }, options = {}) {
  return {
    id: session.id,
    session,
    options: { provider: route.provider, model: route.model, ...options },
    model: { current: () => ({ ...route }), select() { throw new Error('UltraCode must not change the session selection') } },
  }
}

/** A session owner shaped like a 0.1.x Agent: options only, no model selection object. */
export function legacyAgent(session, route = { provider: 'openrouter', model: 'flash' }, options = {}) {
  return { id: session.id, session, options: { provider: route.provider, model: route.model, ...options } }
}

/** A text user message. */
export function userMessage(text) {
  return { role: 'user', id: `m-${text.length}`, source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

/** Let cordis settle pending fibers. */
export const settle = () => new Promise(resolve => setTimeout(resolve, 20))

/**
 * Boot the host half on a real cordis root with fake services.
 * @param config - the ultracode row config.
 * @param services - extra services to provide before loading (name → value).
 */
export async function bootHost(UltraCodeController, config, services = {}) {
  const root = new Context()
  const llm = services.llm ?? fakeLlm()
  const systemPrompt = services.systemPrompt ?? fakeSystemPrompt()
  root.provide('llm', llm)
  root.provide('systemPrompt', systemPrompt)
  for (const [name, value] of Object.entries(services)) {
    if (name === 'llm' || name === 'systemPrompt') continue
    root.provide(name, value)
  }
  const fiber = root.plugin(UltraCodeController, config)
  await fiber
  await settle()
  return { root, fiber, llm, systemPrompt, ultracode: root.get('ultracode') }
}

/** Run one `agent/pre-step` through the root's listeners. */
export function preStep(root, agent, messages, turn = 1, step = 1) {
  return root.waterfall('agent/pre-step', { agent, messages, turn, step, signal: new AbortController().signal, modelSelection: agent.model?.current?.() }, async () => ({ kind: 'enter', messages: [...messages] }))
}
