// Module resolution for the test suite.
//
// The plugin's bundles import DeepSeek Harness packages (`@deepseek-ai/*`) and
// `zod` as peers that the harness installation provides, exactly as a profile
// install resolves them. The tests run against one such installation, named by
// DSH_RUNTIME_NODE_MODULES: a `node_modules` directory that contains
// `@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`, ... and `zod`.
//
// - An installed desktop app:  "<install>/resources/dsh/node_modules"
// - A source checkout:         a link farm built by tests/support/link-monorepo.mjs
//
// A bare specifier that does not resolve from the plugin itself is retried
// from that directory. `tests/run.mjs` sets the variable for each runtime.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.env.DSH_RUNTIME_NODE_MODULES
if (runtime === undefined || runtime === '') {
  throw new Error('DSH_RUNTIME_NODE_MODULES is not set; run the suite through `node tests/run.mjs` (see README "Tests")')
}
const root = resolve(runtime)
if (!existsSync(join(root, '@deepseek-ai', 'cordis'))) {
  throw new Error(`DSH_RUNTIME_NODE_MODULES=${root} does not contain @deepseek-ai/cordis`)
}
const anchor = pathToFileURL(join(root, '__dsh_ultracode_test_anchor__.js')).href

const bare = specifier => !specifier.startsWith('.') && !specifier.startsWith('/')
  && !specifier.startsWith('node:') && !specifier.startsWith('file:') && !specifier.startsWith('data:')

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!bare(specifier) || (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED')) throw error
      return nextResolve(specifier, { ...context, parentURL: anchor })
    }
  },
})
