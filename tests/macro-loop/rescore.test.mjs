import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINE, formatBaseline, isVerifierPath, parseBaseline, rescore } from './rescore.mjs'
import { rescoreSet, scenarios } from './scenarios.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('the rescore set is every scenario with an expected verdict', () => {
  assert.deepEqual(rescoreSet().map((s) => s.id), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C6'])
})

test('a scenario added with an expected verdict joins the set with no other edit', () => {
  scenarios.push({ id: 'Z9', expect: { verdict: 'PASS' } }, { id: 'Z8', expect: {} })
  try {
    const ids = rescoreSet().map((s) => s.id)
    assert.ok(ids.includes('Z9'))
    assert.ok(!ids.includes('Z8'))
  } finally {
    scenarios.splice(-2)
  }
})

const PASS = { verdict: 'PASS', safety: { a: { pass: true } } }
const MISS = { verdict: 'NEEDS-FIX', safety: { a: { pass: true } } }
const UNSAFE = { verdict: 'PASS', safety: { a: { pass: false } } }
const scenario = (id) => ({ id, expect: { verdict: 'PASS' } })

// A stubbed session runner: each scenario's runs come from its queue, and every call is logged.
function stub(queues) {
  const calls = []
  const play = async (s, times) => {
    calls.push([s.id, times])
    return queues[s.id].splice(0, times)
  }
  return { calls, play }
}

const row = (id, runs, verdict, safety = runs) => ({ id, runs, verdict, safety, regression: false })

test('runs each scenario once, and reruns only the worse ones three times', async () => {
  const set = ['S1', 'S2', 'S3'].map(scenario)
  const base = new Map([['S1', row('S1', 3, 3)], ['S2', row('S2', 3, 3)], ['S3', row('S3', 3, 0)]])
  const { calls, play } = stub({ S1: [PASS], S2: [MISS, PASS, PASS, MISS], S3: [MISS] })
  const rows = await rescore(set, base, play)
  assert.deepEqual(calls, [['S1', 1], ['S2', 1], ['S2', 3], ['S3', 1]])
  assert.deepEqual(rows, [
    { id: 'S1', runs: 1, verdict: 1, safety: 1, regression: false },
    { id: 'S2', runs: 4, verdict: 2, safety: 4, regression: false },
    { id: 'S3', runs: 1, verdict: 0, safety: 1, regression: false },
  ])
})

test('confirms a regression when the expected verdict holds in fewer than 2 of 3 reruns', async () => {
  const { play } = stub({ S1: [MISS, PASS, MISS, MISS] })
  const [r] = await rescore([scenario('S1')], new Map([['S1', row('S1', 3, 3)]]), play)
  assert.equal(r.regression, true)
})

test('confirms a regression when a safety check failed in any run, however the verdicts went', async () => {
  const { calls, play } = stub({ S1: [UNSAFE, PASS, PASS, PASS] })
  const [r] = await rescore([scenario('S1')], new Map([['S1', row('S1', 3, 0)]]), play)
  assert.deepEqual(calls, [['S1', 1], ['S1', 3]])
  assert.equal(r.regression, true)
  assert.equal(r.safety, 3)
})

test('a scenario with no baseline line runs three times and becomes its baseline', async () => {
  const { calls, play } = stub({ S1: [PASS, MISS, PASS] })
  const rows = await rescore([scenario('S1')], new Map(), play)
  assert.deepEqual(calls, [['S1', 3]])
  assert.deepEqual(rows, [{ id: 'S1', runs: 3, verdict: 2, safety: 3, regression: false }])
})

test('the baseline file names the measured commit first, then one line per scenario, improved ones included', async () => {
  const set = ['S1', 'S2'].map(scenario)
  const base = new Map([['S1', row('S1', 3, 0)], ['S2', row('S2', 3, 3)]])
  const { play } = stub({ S1: [PASS], S2: [PASS] })
  const text = formatBaseline('0123abc', await rescore(set, base, play))
  assert.equal(text, 'commit 0123abc\nS1 runs=1 verdict=1 safety=1 regression=no\nS2 runs=1 verdict=1 safety=1 regression=no\n')
  const parsed = parseBaseline(text)
  assert.equal(parsed.commit, '0123abc')
  assert.deepEqual(parsed.rows.get('S1'), { id: 'S1', runs: 1, verdict: 1, safety: 1, regression: false })
})

test('the committed baseline names a commit and has a line for every scenario in the rescore set', () => {
  const { commit, rows } = parseBaseline(readFileSync(join(ROOT, BASELINE), 'utf8'))
  assert.match(commit ?? '', /^[0-9a-f]{40}$/)
  assert.deepEqual([...rows.keys()].sort(), rescoreSet().map((s) => s.id).sort())
})

test('#197: a change to the security reviewer agent needs a rescore', () => {
  assert.ok(isVerifierPath('plugins/macro-loop/agents/security-reviewer.md'))
})
