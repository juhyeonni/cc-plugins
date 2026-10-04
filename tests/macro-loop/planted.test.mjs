import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, formatReport } from './checks.mjs'
import { axisReport, namedItems } from './planted.mjs'
import { findScenario } from './scenarios.mjs'

const verifier = (axis, result) => ({ agent: 'main', agentType: 'main', tool: 'Agent', input: { subagent_type: 'macro-loop:verifier', prompt: `Axis: ${axis}\nIssue: #1` }, result })

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
  const calls = [
    verifier('standards', 'Possible Speculative Generality: the separator option, the catch fallback, collapseDashes, and a comment.'),
    verifier('spec', 'Scope creep: slugify(null) now gives an empty string.'),
    // A later standards verifier replaces the first one's report.
    verifier('standards', 'Possible Speculative Generality: the `separator` option.'),
    { agent: 'main', agentType: 'main', tool: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'Axis: standards\ncatch' }, result: 'catch collapseDashes comment' },
  ]
  assert.equal(axisReport(calls, 'standards'), 'Possible Speculative Generality: the `separator` option.')
  assert.deepEqual(namedItems(planted, calls), { option: true, fallback: false, helper: false, comment: false, behavior: true })
})

test('namedItems: an axis without a report gives null for its items', () => {
  const { planted } = findScenario('S1')
  assert.deepEqual(namedItems(planted, [verifier('spec', 'No scope creep.')]), { option: null, fallback: null, helper: null, comment: null, behavior: false })
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
