import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/macro-loop/scripts/verdict.mjs')
const HEAD = 'e8c89722a5abdff1a856f819e8a29805bb426896'

const block = (data) => `\n\n\`\`\`macro-loop-report\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`
const met = (id, words, judged = 'ran') => ({ id, words, result: 'met', judged })
const spec = (over = {}) => ({
  axis: 'spec',
  issue: 12,
  spec: 5976278327,
  criteria: [met('AC1', 'CSV quoted fields'), met('AC2', 'empty input', 'read')],
  manualChecks: [],
  introducedFailures: [],
  couldNotRun: [],
  ...over,
})
const standards = (over = {}) => ({ axis: 'standards', issue: 12, standardsBroken: [], ...over })
const SPEC_PROSE = '| Criterion | Result |\n|---|---|\n| AC1 CSV quoted fields | met |'
const STANDARDS_PROSE = 'No documented standard broken. Possible Mysterious Name: `f` in src/csv.js.'

// Runs the script on report files written to a temp directory.
function run(reports, args = ['--round', '1', '--head', HEAD, '--branch', '12-csv']) {
  const dir = mkdtempSync(join(tmpdir(), 'verdict-'))
  const files = reports.map((text, k) => {
    const file = join(dir, `report-${k}.md`)
    writeFileSync(file, text)
    return file
  })
  return spawnSync(process.execPath, [SCRIPT, ...args, ...files], { encoding: 'utf8' })
}

const ok = (s = spec(), st = standards()) => [SPEC_PROSE + block(s), STANDARDS_PROSE + block(st)]

test('PASS: the marker with round and head, the heading, the counts line, then the opening paragraph', () => {
  const r = run(ok())
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.split('\n')
  assert.deepEqual(lines.slice(0, 5), [
    `<!-- macro-loop:verify round=1 sha=${HEAD} -->`,
    '## Verify: PASS (round 1 of 3)',
    '**Criteria:** 1 ran, 1 read, 0 manual',
    '',
    'This PR can merge. Read this verdict, mark the draft "Ready for review", then merge. Nothing to decide first.',
  ])
  assert.match(r.stdout, /\nNo manual checks\n/)
  assert.match(r.stdout, /\*\*Judged against:\*\* the spec comment on #12\n\n### Spec\n\n\| Criterion/)
  assert.ok(r.stdout.includes(`### Standards\n\n${STANDARDS_PROSE}\n`))
  assert.ok(!r.stdout.includes('macro-loop-report'), 'the data blocks are not posted')
})

test('NEEDS-FIX: an unmet criterion is listed by its ID and words, with the next step', () => {
  const r = run(ok(spec({ criteria: [met('AC1', 'CSV quoted fields'), { id: 'AC2', words: 'empty input', result: 'unmet', judged: 'ran' }] })))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^## Verify: NEEDS-FIX \(round 1 of 3\)$/m)
  assert.match(r.stdout, /^- AC2 empty input: unmet$/m)
  assert.doesNotMatch(r.stdout, /^- AC1/m)
  assert.match(r.stdout, /run `\/macro-loop:implement 12-csv`/)
})

test('NEEDS-FIX: an introduced failure alone fails the verdict; in round 3 a person decides', () => {
  const r = run(ok(spec({ introducedFailures: ['npm test: csv.test.js "quotes" fails only on the head'] })), ['--round', '3', '--head', HEAD, '--branch', '12-csv'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^## Verify: NEEDS-FIX \(round 3 of 3\)$/m)
  assert.match(r.stdout, /^- F1 Introduced failure: npm test: csv\.test\.js "quotes" fails only on the head$/m)
  assert.match(r.stdout, /a person decides what happens next/)
})

test('a wrong criterion fails the verdict too', () => {
  const r = run(ok(spec({ criteria: [{ id: 'AC1', words: 'CSV quoted fields', result: 'wrong', judged: 'read' }] })))
  assert.match(r.stdout, /^## Verify: NEEDS-FIX/m)
  assert.match(r.stdout, /^- AC1 CSV quoted fields: wrong$/m)
})

test('nothing to post: a missing block, an invalid block, a missing report or a could-not-run entry', () => {
  for (const [reports, why] of [
    [[SPEC_PROSE, STANDARDS_PROSE + block(standards())], /does not end with a `macro-loop-report` block/],
    [[SPEC_PROSE + '\n\n```macro-loop-report\n{"axis": "spec",\n```\n', STANDARDS_PROSE + block(standards())], /not valid JSON/],
    [ok(spec({ criteria: [{ id: 'AC1', result: 'passed' }] })), /criterion that is not/],
    [ok(spec(), { axis: 'standards', issue: 12 }), /standardsBroken/],
    [[SPEC_PROSE + block(spec())], /no standards report for #12/],
    [ok(spec({ couldNotRun: ['AC1: npm is not installed'] })), /INCONCLUSIVE.*AC1: npm is not installed/],
    [[SPEC_PROSE + block(spec()) + '\nA note after the block.', STANDARDS_PROSE + block(standards())], /does not end with/],
  ]) {
    const r = run(reports)
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, why)
  }
})

test('the block the report ends with counts, not one quoted above it', () => {
  const quoted = 'The diff adds this example:\n\n```macro-loop-report\n{"axis": "spec"}\n```\n\nMore prose.'
  const r = run([quoted + block(spec()), STANDARDS_PROSE + block(standards())])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('More prose.'))
})

test('the opening paragraph names a broken documented standard instead of "Nothing to decide first"', () => {
  const r = run(ok(spec(), standards({ standardsBroken: ['ADR 0001: src/api.js calls `gh pr view`, which uses GraphQL'] })))
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stdout, /Nothing to decide first/)
  assert.match(r.stdout, /Decide first: the Standards report says the diff breaks these documented standards:\n\n- S1 ADR 0001: src\/api\.js calls `gh pr view`, which uses GraphQL\n/)
})

test('every finding gets an ID in report order: AC IDs, then F1, F2…, then S1, S2…', () => {
  const unmet = { id: 'AC2', words: 'empty input', result: 'unmet', judged: 'ran' }
  const r = run(ok(
    spec({ criteria: [met('AC1', 'CSV quoted fields'), unmet], introducedFailures: ['lint fails', 'a test fails'] }),
    standards({ standardsBroken: ['ADR 0001: GraphQL', 'ADR 0008: no id check'] }),
  ))
  assert.equal(r.status, 0, r.stderr)
  const items = r.stdout.split('\n').filter((l) => /^- (AC|F|S)\d/.test(l))
  assert.deepEqual(items, ['- AC2 empty input: unmet', '- F1 Introduced failure: lint fails', '- F2 Introduced failure: a test fails', '- S1 ADR 0001: GraphQL', '- S2 ADR 0008: no id check'])
})

test('PASS with broken standards lists them as S1, S2…', () => {
  const r = run(ok(spec(), standards({ standardsBroken: ['ADR 0001: GraphQL', 'ADR 0008: no id check'] })))
  assert.match(r.stdout, /^## Verify: PASS/m)
  assert.match(r.stdout, /^- S1 ADR 0001: GraphQL\n- S2 ADR 0008: no id check$/m)
})

test('manual checks come first in what to do, and are listed under the paragraph', () => {
  const r = run(ok(spec({ criteria: [met('AC1', 'CSV quoted fields'), { id: 'AC3', words: 'signed build', result: 'manual', judged: 'manual' }], manualChecks: ['AC3 signed build: open the app on macOS; needs a signed build'] })))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^\*\*Criteria:\*\* 1 ran, 0 read, 1 manual$/m)
  assert.match(r.stdout, /This PR can merge\. Do the manual checks below, read this verdict/)
  assert.match(r.stdout, /^- AC3 signed build: open the app on macOS; needs a signed build$/m)
  assert.doesNotMatch(r.stdout, /No manual checks/)
})

test('no spec: judged against the Issue body', () => {
  const r = run(ok(spec({ spec: null })))
  assert.match(r.stdout, /\*\*Judged against:\*\* no spec; judged against the Issue body/)
})

test('a PR that closes two Issues: one heading for the PR, one section per Issue', () => {
  const unmet = { id: 'AC1', words: 'dots to dashes', result: 'unmet', judged: 'ran' }
  const r = run([...ok(), 'B' + block(spec({ issue: 13, criteria: [unmet] })), 'C' + block(standards({ issue: 13 }))])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^## Verify: NEEDS-FIX \(round 1 of 3\)$/m)
  assert.match(r.stdout, /^- #13 AC1 dots to dashes: unmet$/m)
  assert.match(r.stdout, /^## #12: PASS$/m)
  assert.match(r.stdout, /^## #13: NEEDS-FIX$/m)
})

test('bad arguments print nothing to post', () => {
  for (const args of [[], ['--round', '0', '--head', HEAD, '--branch', 'b'], ['--round', '1', '--head', 'HEAD', '--branch', 'b'], ['--round', '1', '--head', HEAD]]) {
    const r = run(ok(), args)
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

// Reports saved as verifier-report.mjs saves them, in a reports directory of the test's own.
function runAgents(saved, ids) {
  const reports = mkdtempSync(join(tmpdir(), 'reports-'))
  for (const [id, text] of Object.entries(saved)) writeFileSync(join(reports, `${id}.md`), text)
  const args = ['--round', '1', '--head', HEAD, '--branch', '12-csv', ...ids.flatMap((id) => ['--agent', id])]
  return { ...spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, MACRO_LOOP_REPORTS: reports } }), reports }
}

test('--agent <id> reads the saved reports, writes the same comment as from files beside them, and prints only its path and heading', () => {
  const [specReport, standardsReport] = ok()
  const byAgent = runAgents({ aspec1: specReport, astd2: standardsReport }, ['aspec1', 'astd2'])
  assert.equal(byAgent.status, 0, byAgent.stderr)
  const out = join(byAgent.reports, `verdict-${HEAD}.md`)
  const comment = run(ok()).stdout
  assert.equal(readFileSync(out, 'utf8'), comment)
  assert.equal(byAgent.stdout, `${out}\n${comment.split('\n').slice(1, 3).join('\n')}\n`)
  assert.match(byAgent.stdout, /^.+\n## Verify: PASS \(round 1 of 3\)\n\*\*Criteria:\*\*/)
})

test('--agent <id> with no saved report prints nothing to post and names the id', () => {
  const [specReport] = ok()
  const r = runAgents({ aspec1: specReport }, ['aspec1', 'amissing9'])
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /no saved report for verifier amissing9/)
})
