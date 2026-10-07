import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// A checkout with autocrlf has CRLF files; the generator writes LF.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const { readManifests, listedPlugins, syncMarketplace, readmeBlock } = await import(
  pathToFileURL(join(ROOT, 'scripts', 'gen-readme.mjs')).href
)

const man = (n) => ({ dir: n, name: n, description: `${n} does x. More.`, requirements: '—', version: '1.0.0' })

test('fixture: an unlisted plugin stays out of block and marketplace', () => {
  const m = { name: 'mk', plugins: [{ name: 'a', extra: 1 }, { name: 'b' }] }
  const listed = listedPlugins(m, [man('a'), man('b'), man('unlisted')])
  const block = readmeBlock(m.name, listed)
  assert.match(block, /\[a\]/)
  assert.match(block, /\[b\]/)
  assert.ok(!block.includes('unlisted'))
  const synced = syncMarketplace(m, listed)
  assert.deepEqual(synced.plugins.map((p) => p.name), ['a', 'b'])
  assert.equal(synced.plugins[0].extra, 1)
})

const m = JSON.parse(read('.claude-plugin/marketplace.json'))
const listed = listedPlugins(m, readManifests(join(ROOT, 'plugins')))

test('real repo: block matches README and lists every marketplace plugin', () => {
  const block = readmeBlock(m.name, listed)
  for (const p of m.plugins) assert.ok(block.includes(`[${p.name}]`), p.name)
  assert.ok(read('README.md').includes(block))
})

test('real repo: syncMarketplace equals the current marketplace', () => {
  assert.deepEqual(syncMarketplace(m, listed), m)
})
