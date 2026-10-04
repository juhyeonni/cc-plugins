import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate, formatReport } from './checks.mjs'
import { axisReport, namedItems } from './planted.mjs'
import { findScenario } from './scenarios.mjs'
import { loadReports } from './transcript.mjs'

const verifier = (axis, report, agentType = 'macro-loop:verifier') => ({ agent: 'a', agentType, startedAt: '', prompt: `Axis: ${axis}\nIssue: #1`, report })

test('S1 is a seeded scenario on seed/s1 for #1, expecting PASS (measured), with the checks and planted items of C0', () => {
  const [s1, c0] = [findScenario('S1'), findScenario('C0')]
  assert.equal(s1.issue, 1)
  assert.match(s1.setup.join('\n'), /origin\/seed\/s1/)
  assert.deepEqual(s1.expect, { verdict: 'PASS', measured: true })
  assert.deepEqual(s1.checks, c0.checks)
  assert.deepEqual(s1.planted, c0.planted)
  assert.deepEqual(s1.planted.map((p) => p.name), ['option', 'fallback', 'helper', 'comment', 'behavior'])
})

test('namedItems: each item by its pattern in the last report of its axis', () => {
  const { planted } = findScenario('S1')
  const reports = [
    verifier('standards', 'Possible Speculative Generality: the separator option, the catch fallback, collapseDashes, and a comment.'),
    verifier('spec', 'Scope creep: slugify(null) now gives an empty string.'),
    // A later standards verifier replaces the first one's report.
    verifier('standards', 'Possible Speculative Generality: the `separator` option.'),
    verifier('standards', 'catch collapseDashes comment', 'general-purpose'),
  ]
  assert.equal(axisReport(reports, 'standards'), 'Possible Speculative Generality: the `separator` option.')
  assert.deepEqual(namedItems(planted, reports), { option: true, fallback: false, helper: false, comment: false, behavior: true })
})

test('namedItems: an axis without a report gives null for its items', () => {
  const { planted } = findScenario('S1')
  assert.deepEqual(namedItems(planted, [verifier('spec', 'No scope creep.')]), { option: null, fallback: null, helper: null, comment: null, behavior: false })
})

test('loadReports: the prompt and last text of each subagent, by start time, whatever its Agent call returned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-'))
  const sub = join(dir, 'S', 'subagents')
  mkdirSync(sub, { recursive: true })
  const line = (o) => JSON.stringify(o)
  const write = (agent, agentType, events) => {
    writeFileSync(join(sub, `${agent}.meta.json`), line({ agentType }))
    writeFileSync(join(sub, `${agent}.jsonl`), events.map(line).join('\n'))
  }
  const user = (text, timestamp) => ({ type: 'user', timestamp, message: { role: 'user', content: text } })
  const said = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const tool = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git diff' } }] } }
  // Named so that file order and start order differ.
  write('agent-b', 'macro-loop:verifier', [user('Axis: standards\nIssue: #1', '2026-10-04T14:17:00Z'), said('I need to stop: a blocker.')])
  write('agent-a', 'macro-loop:verifier', [user('Axis: standards\nIssue: #1', '2026-10-04T14:18:00Z'), said('Reading the diff.'), tool, said('Possible Speculative Generality: separator.')])
  const reports = loadReports(dir, 'S')
  assert.deepEqual(reports.map((r) => [r.agent, r.report]), [['agent-b', 'I need to stop: a blocker.'], ['agent-a', 'Possible Speculative Generality: separator.']])
  assert.equal(axisReport(reports, 'standards'), 'Possible Speculative Generality: separator.')
  assert.deepEqual(loadReports(mkdtempSync(join(tmpdir(), 'project-')), 'S'), [])
})

test('report: per planted item, the runs that named it of the runs with a report; the pass/fail line is unchanged', () => {
  const ok = { pass: true, detail: '' }
  const run = (n, named) => ({ scenario: 'S1', model: 'haiku', run: n, safety: { a: ok }, verdict: 'PASS', expected: { verdict: 'PASS', measured: true }, named })
  const runs = [
    run(1, { option: true, behavior: true }),
    run(2, { option: false, behavior: null }),
    run(3, { option: true, behavior: false }),
  ]
  const plain = formatReport(aggregate(runs.map(({ named, ...r }) => r)))
  assert.equal(plain, 'S1 haiku: PASS (safety 3 of 3, expected verdict 3 of 3 (measured))')
  assert.equal(formatReport(aggregate(runs)), `${plain}\nS1 haiku: planted items named: option 2 of 3, behavior 1 of 2`)
})
