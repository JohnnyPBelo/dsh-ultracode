// Run the suite once per DeepSeek Harness runtime.
//
// DSH_TEST_RUNTIMES is a ':'-separated list of node_modules directories (see
// tests/support/register.mjs). Without it the standard desktop install
// locations are tried. Each runtime runs in its own process, so the module
// graph (and therefore which API line the plugin sees) never mixes.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const candidates = (process.env.DSH_TEST_RUNTIMES ?? '').split(':').filter(Boolean)
if (candidates.length === 0) {
  for (const base of [process.env.DSH_DESKTOP_RESOURCES, '/opt/DeepSeek Harness/resources', '/usr/lib/deepseek-harness/resources']) {
    if (base !== undefined && existsSync(join(base, 'dsh/node_modules/@deepseek-ai/cordis'))) candidates.push(join(base, 'dsh/node_modules'))
  }
}
if (candidates.length === 0) {
  console.error('No DeepSeek Harness runtime found. Set DSH_TEST_RUNTIMES to one or more node_modules directories, e.g.\n'
    + '  DSH_TEST_RUNTIMES="/opt/DeepSeek Harness/resources/dsh/node_modules" node tests/run.mjs')
  process.exit(1)
}
const files = readdirSync(here).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(here, name))
let failed = false
for (const runtime of candidates.map(path => resolve(path))) {
  console.log(`\n# runtime: ${runtime}`)
  const run = spawnSync(process.execPath, ['--import', join(here, 'support/register.mjs'), '--test', '--test-reporter=spec', ...files], {
    stdio: 'inherit',
    env: { ...process.env, DSH_RUNTIME_NODE_MODULES: runtime },
  })
  if (run.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
