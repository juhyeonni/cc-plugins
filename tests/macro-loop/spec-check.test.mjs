import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/macro-loop/scripts/spec-check.mjs')

const run = (path) => spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' })
const runDraft = (draft) => {
  const path = join(mkdtempSync(join(tmpdir(), 'spec-check-')), 'draft.md')
  writeFileSync(path, draft)
  return run(path)
}
const check = (draft) => {
  const r = runDraft(draft)
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

test('#283 AC10: counts the criteria and the runnable ones; fewer than half runnable is fewRunnable', () => {
  const three = runDraft(spec(['- D1. d: r'], ['- [ ] AC1 (D1). a · check: test', '- [ ] AC2. b · check: manual, open it', '- [ ] AC3. c']))
  assert.equal(three.status, 0, three.stderr)
  assert.ok(three.stdout.includes('"criteria":3,"runnable":1,"fewRunnable":true'), three.stdout)
  const four = runDraft(spec(['- D1. d: r'], ['- [ ] AC1 (D1). a · check: test', '- [ ] AC2. b · check: cmd `true`', '- [ ] AC3. c · check: manual, look', '- [ ] AC4. d']))
  assert.deepEqual(JSON.parse(four.stdout), { uncovered: [], criteria: 4, runnable: 2, fewRunnable: false, guardSuspects: [] })
})

test('#283 AC11: fewRunnable is a warning: with no uncovered decision the run exits 0 with "uncovered":[]', () => {
  const r = runDraft(spec(['- D1. d: r'], ['- [ ] AC1 (D1). a · check: manual, look', '- [ ] AC2. b']))
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('"uncovered":[]'), r.stdout)
  assert.equal(JSON.parse(r.stdout).fewRunnable, true)
})

const suspects = (draft) => {
  const r = runDraft(draft)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout).guardSuspects
}

test('#325 AC1: a check: test criterion naming a decision that says "as today" is a guard suspect', () => {
  const draft = spec(
    ['- D1. Count children as today: readers rely on it.', '- D2. Add a new stage: it is needed.'],
    ['- [ ] AC1 (D2). The new stage is given · check: test', '- [ ] AC2 (D1). A ticked child counts as done · check: test'],
  )
  assert.deepEqual(suspects(draft), ['AC2'])
})

test('#325 AC2: #307 AC2, #308 AC2 and #316 AC3, as first published, are guard suspects', () => {
  const s307 = spec(
    ['- D3. `execute.mjs` puts a waiting Issue in `left` with the reason `waits for #<n> to merge` (each open blocker), whatever its stage: which Issues run is decided in code (#39), and every caller of `execute.mjs`, `goal` included, gets it.'],
    ['- [ ] AC2 (D3). An Issue with no blockers runs exactly as today · check: test'],
  )
  const s308 = spec(
    ["- D2. `stage.mjs` counts only `- [ ] #<n>` items as children, as it does today, so the `## After the children` items never block the tracking Issue's stage. The goal run's summary lists them under what you must still do, unticked ones first."],
    ["- [ ] AC2 (D2). For a tracking Issue whose children are all ticked and which has an unticked item under `## After the children`, `stage.mjs` gives `merge` with all children counted done · check: test"],
  )
  const s316 = spec(
    ['- D3. The round cap comes first, as today: three verdicts with the newest NEEDS-FIX is still `stop`, whatever the spec did.'],
    ['- [ ] AC3 (D3). Three NEEDS-FIX verdicts give `stop` even when the spec was updated after the newest one · check: test'],
  )
  assert.deepEqual(suspects(s307), ['AC2'])
  assert.deepEqual(suspects(s308), ['AC2'])
  assert.deepEqual(suspects(s316), ['AC3'])
})

test('#325 AC3: the guard mark or a closing Not a guard note clears a suspect', () => {
  const draft = spec(
    ['- D1. Count children as today: readers rely on it.'],
    [
      '- [ ] AC1 (D1). A ticked child counts as done (guards existing behavior) · check: test',
      '- [ ] AC2 (D1). An unticked child is not done · check: test Not a guard: the base counts it done',
    ],
  )
  assert.deepEqual(suspects(draft), [])
})

test('#325 AC4: a cmd or manual criterion with the same words is not a suspect', () => {
  const draft = spec(
    ['- D1. Count children as today: readers rely on it.'],
    ['- [ ] AC1 (D1). Output stays unchanged · check: cmd `true`', '- [ ] AC2 (D1). It works exactly as before · check: manual, look'],
  )
  assert.deepEqual(suspects(draft), [])
})

test('a draft that cannot be read prints nothing and exits non-zero', () => {
  const r = run(join(tmpdir(), 'spec-check-missing', 'draft.md'))
  assert.equal(r.stdout, '')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /^spec-check: cannot read the draft: /)
})
