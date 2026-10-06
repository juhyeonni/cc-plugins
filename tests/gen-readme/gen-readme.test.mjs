import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { readManifests, listedPlugins, syncMarketplace, readmeBlock } = await import(
  pathToFileURL(resolve('scripts/gen-readme.mjs')).href
)

const man = (n) => ({ dir: n, name: n, description: `${n} does x. More.`, requirements: '—', version: '1.0.0' })

test('fixture: an unlisted plugin stays out of block and marketplace', () => {
  const m = { name: 'mk', plugins: [{ name: 'a', extra: 1 }, { name: 'b' }] }
  const listed = listedPlugins(m, [man('a'), man('b'), man('macro-loop-band')])
  const block = readmeBlock(m.name, listed)
  assert.match(block, /\[a\]/)
  assert.match(block, /\[b\]/)
  assert.ok(!block.includes('macro-loop-band'))
  const synced = syncMarketplace(m, listed)
  assert.deepEqual(synced.plugins.map((p) => p.name), ['a', 'b'])
  assert.equal(synced.plugins[0].extra, 1)
})

const m = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const listed = listedPlugins(m, readManifests('plugins'))

test('real repo: block matches README and omits macro-loop-band', () => {
  const block = readmeBlock(m.name, listed)
  assert.ok(!block.includes('macro-loop-band'))
  for (const p of m.plugins) assert.ok(block.includes(`[${p.name}]`), p.name)
  assert.ok(readFileSync('README.md', 'utf8').includes(block))
})

test('real repo: syncMarketplace equals the current marketplace', () => {
  assert.deepEqual(syncMarketplace(m, listed), m)
})
