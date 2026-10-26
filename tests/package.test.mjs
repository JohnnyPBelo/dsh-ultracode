// Packaging: manifest, bundle patch, and resolvable imports.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeRequire, world } from './support/fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('manifest', () => {
  test('every export target exists', () => {
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const file = typeof target === 'string' ? target : target.default
      assert.ok(existsSync(join(root, file)), `${subpath} → ${file}`)
    }
  })
  test(`every @deepseek-ai/dsh* peer range admits this runtime (${world.sessionVersion}) and 0.2.1-rc.3`, { skip: helper('semver') === undefined && 'this runtime ships no semver' }, () => {
    const semver = helper('semver')
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh')) continue
      for (const version of [world.sessionVersion, '0.2.1-rc.3', '0.1.0-rc.8']) {
        assert.ok(semver.satisfies(version, range, { includePrerelease: true }), `${name} ${range} vs ${version}`)
      }
    }
  })
})

/** A runtime helper package, or undefined when this runtime does not ship it. */
function helper(name) {
  try { return runtimeRequire(name) } catch { return undefined }
}

describe('bundle patch', { skip: helper('js-yaml') === undefined && 'this runtime ships no js-yaml' }, () => {
  const yaml = helper('js-yaml')
  const rows = yaml === undefined ? [] : yaml.load(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))[0].insert
  test('keeps the two-row design: bare package row plus a subpath row', () => {
    assert.deepEqual(rows.map(row => [row.id, row.name]), [['ultracode', 'dsh-ultracode'], ['tool-ultracode-delegate', 'dsh-ultracode/delegate']])
    assert.equal(rows[1].config.provider, 'spawn')
  })
  test('names no provider an installation might lack', async () => {
    assert.equal(rows[0].config.catalog, undefined)
    const { Config, resolveConfig } = await import('../lib/host.js')
    assert.deepEqual(resolveConfig(Config.parse(rows[0].config)).catalog.routes, [])
    const delegate = await import('../lib/delegate.js')
    assert.doesNotThrow(() => delegate.Config.parse(rows[1].config))
  })
})

describe('bundles', () => {
  const files = [...readdirSync(join(root, 'lib')).filter(f => f.endsWith('.js')).map(f => join(root, 'lib', f)),
    ...readdirSync(join(root, 'lib/types-host')).filter(f => f.endsWith('.js')).map(f => join(root, 'lib/types-host', f))]
  test('every import specifier resolves on this runtime', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const [, specifier] of source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        assert.doesNotThrow(() => import.meta.resolve(specifier.startsWith('.') ? new URL(specifier, `file://${file}`).href : specifier), `${file}: ${specifier}`)
      }
    }
  })
  test('no bundle uses the retired `plugin` message source kind', () => {
    for (const file of [...files, join(root, 'client/client.js')]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /kind:\s*['"]plugin['"]/, file)
    }
  })
  test('the client bundle references no missing source map', () => {
    assert.doesNotMatch(readFileSync(join(root, 'client/client.js'), 'utf8'), /sourceMappingURL/)
  })
})
