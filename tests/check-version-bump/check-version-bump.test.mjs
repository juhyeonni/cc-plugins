import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { check, parseRelease } = await import(pathToFileURL(join(ROOT, 'scripts', 'check-version-bump.mjs')).href)

test('passes when the manifest has the branch version and the base differs', () => {
  assert.equal(check('release/macro-loop-0.5.0', '0.5.0', '0.4.1').ok, true)
})

test('fails and names the plugin when the version is unchanged', () => {
  const r = check('release/macro-loop-0.5.0', '0.5.0', '0.5.0')
  assert.equal(r.ok, false)
  assert.match(r.message, /macro-loop/)
})

test('fails when the manifest differs from the branch', () => {
  const r = check('release/macro-loop-0.5.0', '0.4.2', '0.4.1')
  assert.equal(r.ok, false)
  assert.match(r.message, /macro-loop/)
})

test('fails when the plugin has no manifest', () => {
  const r = check('release/ghost-1.0.0', undefined, undefined)
  assert.equal(r.ok, false)
  assert.match(r.message, /ghost/)
})

test('handles a plugin name with - in it', () => {
  assert.deepEqual(parseRelease('release/annotated-ui-pdf-1.2.3'), { plugin: 'annotated-ui-pdf', version: '1.2.3' })
})

test('skips any other branch', () => {
  for (const b of ['main', '69-ci-workflow', 'release/', undefined]) {
    const r = check(b, undefined, undefined)
    assert.equal(r.ok, true)
    assert.match(r.message, /skipped/)
  }
})
