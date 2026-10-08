import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/annotated-ui-pdf/skills/annotated-ui-pdf/scripts/build.mjs')

// build.mjs writes the HTML before it looks for Chrome. An empty PATH and no
// CHROME_PATH keep it from finding one on Linux and Windows, so it stops after
// the HTML (exit 2) instead of rendering. On a Mac with Chrome installed it
// renders as well, and the HTML is still there to read.
const build = (spec) => {
  const dir = mkdtempSync(join(tmpdir(), 'annotated-ui-pdf-'))
  writeFileSync(join(dir, 'shot.png'), '')
  const specPath = join(dir, 'spec.json')
  writeFileSync(specPath, JSON.stringify(spec))
  const emptyBin = join(dir, 'bin')
  mkdirSync(emptyBin)
  const env = { ...process.env, PATH: emptyBin, Path: emptyBin }
  delete env.CHROME_PATH
  const r = spawnSync(process.execPath, [SCRIPT, specPath, join(dir, 'out.pdf')], { encoding: 'utf8', env })
  const htmlPath = join(dir, 'out.html')
  return { status: r.status, stderr: r.stderr, html: existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null }
}

const imagePage = (over = {}) => ({ label: 'Screen', image: 'shot.png', imageW: 1000, imageH: 2000, boxes: [], ...over })
const box = (over = {}) => ({ x: 0, y: 0, w: 10, h: 10, title: 't', caption: 'c', ...over })

// The box's inline style, in the order build.mjs writes it.
const boxStyles = (html) =>
  [...html.matchAll(/<div class="box[^"]*" style="left:([\d.-]+)%;top:([\d.-]+)%;width:([\d.-]+)%;height:([\d.-]+)%;"/g)]
    .map((m) => m.slice(1, 5).map(Number))

test('lang: a spec without lang renders lang="en"', () => {
  const { html } = build({ pages: [imagePage()] })
  assert.ok(html, 'no HTML written')
  assert.match(html, /<html lang="en">/)
})

test('lang: a spec with lang "ja" keeps ja', () => {
  const { html } = build({ lang: 'ja', pages: [imagePage()] })
  assert.ok(html, 'no HTML written')
  assert.match(html, /<html lang="ja">/)
})

test('valid spec: the build gets past validation', () => {
  const { status, stderr } = build({ pages: [imagePage()] })
  assert.notEqual(status, 1, stderr)
  assert.doesNotMatch(stderr, /ERROR:/)
})

test('invalid: a spec with no pages exits 1 and says so', () => {
  const { status, stderr, html } = build({ pages: [] })
  assert.equal(status, 1)
  assert.match(stderr, /ERROR: spec\.pages is empty/)
  assert.equal(html, null)
})

test('invalid: each error in a spec is named on stderr, and the build exits 1', () => {
  const { status, stderr, html } = build({
    lead: 'see page {ref:nowhere}',
    pages: [
      { label: 'No size', image: 'shot.png', boxes: [] },
      imagePage({ label: 'Bad box', boxes: [box({ x: '10' })] }),
    ],
  })
  assert.equal(status, 1)
  assert.match(stderr, /ERROR: pages\[0\] \(No size\): an image page needs positive imageW\/imageH/)
  assert.match(stderr, /ERROR: pages\[1\] \(Bad box\)\.boxes\[0\]: x is not a number/)
  assert.match(stderr, /ERROR: unresolved reference \{ref:nowhere\}/)
  assert.match(stderr, /Invalid spec \(3 error\(s\)\)/)
  assert.equal(html, null)
})

test('boxes: on a full-page image, x/y/w/h are percentages of imageW/imageH', () => {
  const { html } = build({ pages: [imagePage({ boxes: [box({ x: 100, y: 500, w: 200, h: 100 })] })] })
  assert.ok(html, 'no HTML written')
  assert.deepEqual(boxStyles(html), [[10, 25, 20, 5]])
})

test('boxes: with a crop, they are percentages of the crop, offset by its origin', () => {
  const { html } = build({
    pages: [imagePage({ crop: { x: 200, y: 400, w: 400, h: 500 }, boxes: [box({ x: 300, y: 450, w: 100, h: 50 })] })],
  })
  assert.ok(html, 'no HTML written')
  assert.deepEqual(boxStyles(html), [[25, 10, 25, 10]])
})
