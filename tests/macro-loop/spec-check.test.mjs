import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/macro-loop/scripts/spec-check.mjs')

const run = (path) => spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' })
const check = (draft) => {
  const path = join(mkdtempSync(join(tmpdir(), 'spec-check-')), 'draft.md')
  writeFileSync(path, draft)
  const r = run(path)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout).uncovered
}
const spec = (decisions, criteria) =>
  `<!-- macro-loop:spec -->\n## Spec\n\n**Goal:** g\n\n**Decisions**\n${decisions.join('\n')}\n\n**Acceptance criteria**\n${criteria.join('\n')}\n\n**Out of scope**\n- D2 is not about this\n`

test('reports the decision no criterion names and no note excuses', () => {
  const draft = spec(
    ['- D1. Parse quoted fields: CSV allows them.', '- D2. Keep the header: readers need it.', '- D3. Use the stdlib parser. No check: a choice of library, no behavior'],
    ['- [ ] AC1 (D1). A quoted field keeps its comma · check: test'],
  )
  assert.deepEqual(check(draft), ['D2'])
})

test('naming D10 does not cover D1', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `- D${i + 1}. d${i + 1}: r`)
  const covers = Array.from({ length: 9 }, (_, i) => `- [ ] AC${i + 1} (D${i + 2}). b · check: test`)
  assert.deepEqual(check(spec(ten, covers)), ['D1'])
})

test('a No check note without a reason does not cover its decision', () => {
  assert.deepEqual(check(spec(['- D1. Use the stdlib parser. No check:', '- D2. d: r No check:   '], [])), ['D1', 'D2'])
})

test('a draft with no Decisions section has nothing uncovered', () => {
  assert.deepEqual(check('<!-- macro-loop:spec -->\n## Spec\n\n**Goal:** g\nRoute: short\n\n**Acceptance criteria**\n- [ ] AC1. b · check: test\n'), [])
})

test('a draft that cannot be read prints nothing and exits non-zero', () => {
  const r = run(join(tmpdir(), 'spec-check-missing', 'draft.md'))
  assert.equal(r.stdout, '')
  assert.notEqual(r.status, 0)
})
