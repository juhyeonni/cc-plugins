import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINE, formatBaseline, isVerifierPath, loadRows, parseBaseline, rescore, rescoreToFile, retrying, saveRow } from './rescore.mjs'
import { rescoreSet, scenarios } from './scenarios.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('the rescore set is every scenario with an expected verdict', () => {
  assert.deepEqual(rescoreSet().map((s) => s.id), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
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
    { id: 'S1', runs: 1, verdict: 1, safety: 1, regression: false, flaky: null, noverdict: 0 },
    { id: 'S2', runs: 4, verdict: 2, safety: 4, regression: false, flaky: true, noverdict: 0 },
    { id: 'S3', runs: 1, verdict: 0, safety: 1, regression: false, flaky: null, noverdict: 0 },
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
  assert.deepEqual(rows, [{ id: 'S1', runs: 3, verdict: 2, safety: 3, regression: false, flaky: true, noverdict: 0 }])
})

test('the baseline file names the measured commit first, then one line per scenario, improved ones included', async () => {
  const set = ['S1', 'S2'].map(scenario)
  const base = new Map([['S1', row('S1', 3, 0)], ['S2', row('S2', 3, 3)]])
  const { play } = stub({ S1: [PASS], S2: [PASS] })
  const text = formatBaseline('0123abc', await rescore(set, base, play))
  assert.equal(text, 'commit 0123abc\nS1 runs=1 verdict=1 safety=1 regression=no noverdict=0\nS2 runs=1 verdict=1 safety=1 regression=no noverdict=0\n')
  const parsed = parseBaseline(text)
  assert.equal(parsed.commit, '0123abc')
  assert.deepEqual(parsed.rows.get('S1'), { id: 'S1', runs: 1, verdict: 1, safety: 1, regression: false, flaky: null, noverdict: 0 })
})

test('the committed baseline names a commit and has a line for every scenario in the rescore set', () => {
  const { commit, rows } = parseBaseline(readFileSync(join(ROOT, BASELINE), 'utf8'))
  assert.match(commit ?? '', /^[0-9a-f]{40}$/)
  assert.deepEqual([...rows.keys()].sort(), rescoreSet().map((s) => s.id).sort())
})

test('#197: a change to the security reviewer agent needs a rescore', () => {
  assert.ok(isVerifierPath('plugins/macro-loop/agents/security-reviewer.md'))
})

// #214
const NOCOMMENT = { verdict: 'PASS', noVerdict: true, safety: { a: { pass: true } } }
const hits = (n, of) => Array.from({ length: of }, (_, i) => (i < n ? PASS : MISS))
const flakyOfRuns = async (n, of) => (await rescore([scenario('S1')], new Map(), stub({ S1: hits(n, of) }).play))[0].flaky

test('AC1: 3 of 3 and 0 of 3 are not flaky, 2 of 3 and 1 of 3 are', async () => {
  assert.equal(await flakyOfRuns(3, 3), false)
  assert.equal(await flakyOfRuns(2, 3), true)
  assert.equal(await flakyOfRuns(1, 3), true)
  assert.equal(await flakyOfRuns(0, 3), false)
})

test('AC2: a row with fewer than 3 runs records flaky as not measured', async () => {
  const [r] = await rescore([scenario('S1')], new Map([['S1', row('S1', 3, 3)]]), stub({ S1: [PASS] }).play)
  assert.equal(r.flaky, null)
  assert.ok(!formatBaseline('abc1234', [r]).includes('flaky='))
})

test('AC3: a flaky scenario that misses its verdict is no regression and starts no extra runs', async () => {
  const { calls, play } = stub({ S1: [MISS] })
  const [r] = await rescore([scenario('S1')], new Map([['S1', { ...row('S1', 3, 2), flaky: true }]]), play)
  assert.deepEqual(calls, [['S1', 1]])
  assert.equal(r.regression, false)
})

test('AC4: a flaky scenario with a failed safety check is a regression, whatever its verdicts', async () => {
  const { calls, play } = stub({ S1: [UNSAFE, PASS, PASS, PASS] })
  const [r] = await rescore([scenario('S1')], new Map([['S1', { ...row('S1', 3, 2), flaky: true }]]), play)
  assert.deepEqual(calls, [['S1', 1], ['S1', 3]])
  assert.equal(r.regression, true)
  const again = stub({ S1: [MISS, PASS, PASS, PASS] })
  assert.equal((await rescore([scenario('S1')], new Map([['S1', { ...row('S1', 3, 2), flaky: true }]]), again.play))[0].regression, false)
})

test('AC5: a run with no verdict comment is a noVerdict and a verdict miss, not a safety failure', async () => {
  const [r] = await rescore([scenario('S1')], new Map(), stub({ S1: [NOCOMMENT, PASS, PASS] }).play)
  assert.deepEqual([r.verdict, r.noverdict, r.safety], [2, 1, 3])
})

test('AC7: a row with flaky and noverdict round-trips through the baseline text', () => {
  const rows = [
    { id: 'S1', runs: 3, verdict: 2, safety: 3, regression: false, flaky: true, noverdict: 1 },
    { id: 'S2', runs: 1, verdict: 1, safety: 1, regression: true, flaky: null, noverdict: 0 },
  ]
  const { rows: back } = parseBaseline(formatBaseline('abc1234', rows))
  assert.deepEqual([...back.values()], rows)
})

test('AC8: an old line parses with flaky not measured and noverdict 0', () => {
  const { rows } = parseBaseline('commit abc1234\nS1 runs=4 verdict=4 safety=3 regression=yes\n')
  assert.deepEqual(rows.get('S1'), { id: 'S1', runs: 4, verdict: 4, safety: 3, regression: true, flaky: null, noverdict: 0 })
})

test('AC9: a resumed rescore runs only the scenarios with no saved row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resume-'))
  try {
    saveRow(dir, { id: 'S1', runs: 1, verdict: 1, safety: 1, regression: false, flaky: null, noverdict: 0 })
    const { calls, play } = stub({ S2: [PASS] })
    const rows = await rescore(['S1', 'S2'].map(scenario), new Map([['S2', row('S2', 3, 3)]]), play, { saved: loadRows(dir) })
    assert.deepEqual(calls, [['S2', 1]])
    assert.deepEqual(rows.map((r) => r.id), ['S1', 'S2'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AC10: the baseline file is not written when a rescore stops early', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-'))
  const file = join(dir, 'baseline.txt')
  const play = async (s) => {
    if (s.id === 'S2') throw new Error('network down')
    return [PASS]
  }
  try {
    const base = new Map([['S1', row('S1', 3, 3)], ['S2', row('S2', 3, 3)]])
    await assert.rejects(rescoreToFile(file, 'abc1234', ['S1', 'S2'].map(scenario), base, play), /network down/)
    assert.throws(() => readFileSync(file), /ENOENT/)
    await rescoreToFile(file, 'abc1234', [scenario('S1')], base, play)
    assert.match(readFileSync(file, 'utf8'), /^commit abc1234\nS1 runs=1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AC11: a failed session is retried at most twice and the retries do not count in runs; three failures stop the rescore', async () => {
  let failures = 2
  const flaky = async () => {
    if (failures-- > 0) throw new Error('session failed')
    return PASS
  }
  const play = async (s, times) => Promise.all(Array.from({ length: times }, () => retrying(flaky)))
  const [r] = await rescore([scenario('S1')], new Map(), play)
  assert.equal(r.runs, 3)
  let tries = 0
  await assert.rejects(retrying(async () => { tries++; throw new Error('still down') }), /still down/)
  assert.equal(tries, 3)
})
