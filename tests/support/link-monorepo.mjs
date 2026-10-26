// Build a resolution root from a DeepSeek Harness source checkout whose
// packages are already built (`lib/` present): one symlink per workspace
// package under <out>/node_modules/@deepseek-ai/, plus `zod`.
//
// Usage: node tests/support/link-monorepo.mjs <monorepo> <out>
// Then:  DSH_TEST_RUNTIMES=<out>/node_modules node tests/run.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [monorepoArg, outArg] = process.argv.slice(2)
if (monorepoArg === undefined || outArg === undefined) {
  console.error('usage: node tests/support/link-monorepo.mjs <monorepo> <out>')
  process.exit(2)
}
const monorepo = resolve(monorepoArg)
const modules = join(resolve(outArg), 'node_modules')
rmSync(modules, { recursive: true, force: true })
mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })

/** Every package.json under packages/ and vendor/, two or three levels down. */
function* manifests(base, depth) {
  if (depth < 0 || !existsSync(base)) return
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const dir = join(base, entry.name)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) yield manifest
    else yield* manifests(dir, depth - 1)
  }
}

let linked = 0
for (const manifest of [...manifests(join(monorepo, 'packages'), 3), ...manifests(join(monorepo, 'vendor'), 1)]) {
  let name
  try { name = JSON.parse(readFileSync(manifest, 'utf8')).name } catch { continue }
  if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
  const target = join(modules, name)
  if (existsSync(target)) continue
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(dirname(manifest), target, 'dir')
  linked++
}
// zod: whichever copy the session package resolves.
const zodFrom = [join(monorepo, 'packages/core/session/node_modules/zod'), join(monorepo, 'packages/ultracode/ultracode/node_modules/zod'), join(monorepo, 'node_modules/zod')]
  .find(candidate => existsSync(candidate))
if (zodFrom !== undefined) symlinkSync(realpathSync(zodFrom), join(modules, 'zod'), 'dir')
// Test helpers the suite reads manifests with, when the checkout has them.
for (const helper of ['semver', 'js-yaml']) {
  const from = [join(monorepo, 'node_modules', helper), join(monorepo, 'packages/boot/app-boot/node_modules', helper)].find(candidate => existsSync(candidate))
  if (from !== undefined && !existsSync(join(modules, helper))) symlinkSync(realpathSync(from), join(modules, helper), 'dir')
}
console.log(`linked ${String(linked)} @deepseek-ai packages${zodFrom === undefined ? ' (zod NOT found)' : ' and zod'} into ${modules}`)
