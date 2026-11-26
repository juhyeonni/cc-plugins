import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINE, accuracy, confusion, formatAccuracy, formatBaseline, isVerifierPath, loadRows, parseBaseline, rescore, rescoreToFile, retrying, saveRow } from './rescore.mjs'
import { rescoreSet, scenarios } from './scenarios.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('the rescore set is every scenario with an expected verdict', () => {
  assert.deepEqual(rescoreSet().map((s) => s.id), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'M1', 'M3', 'M5'])
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

const row = (id, runs, verdict, safety = runs) => ({ id, runs, verdict, safety, regression: false, flaky: null, noverdict: 0 })

test('runs each scenario once, and reruns only the worse ones three times', async () => {
  const set = ['S1', 'S2', 'S3'].map(scenario)
  const base = new Map([['S1', row('S1', 3, 3)], ['S2', row('S2', 3, 3)], ['S3', row('S3', 3, 0)]])
  const { calls, play } = stub({ S1: [PASS], S2: [MISS, PASS, PASS, MISS], S3: [MISS] })
  const rows = await rescore(set, base, play)
  assert.deepEqual(calls, [['S1', 1], ['S2', 1], ['S2', 3], ['S3', 1]])
  assert.deepEqual(rows, [
    { id: 'S1', runs: 4, verdict: 4, safety: 4, regression: false, flaky: null, noverdict: 0 },
    { id: 'S2', runs: 7, verdict: 5, safety: 7, regression: false, flaky: true, noverdict: 0 },
    { id: 'S3', runs: 4, verdict: 0, safety: 4, regression: false, flaky: null, noverdict: 0 },
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
  assert.equal(text, 'commit 0123abc\nS1 runs=4 verdict=1 safety=4 regression=no noverdict=0\nS2 runs=4 verdict=4 safety=4 regression=no noverdict=0\n')
  const parsed = parseBaseline(text)
  assert.equal(parsed.commit, '0123abc')
  assert.deepEqual(parsed.rows.get('S1'), { id: 'S1', runs: 4, verdict: 1, safety: 4, regression: false, flaky: null, noverdict: 0 })
})

// A mutant gets its first line at the next rescore (#257 D8).
test('the committed baseline names a commit and has a line for every scenario in the rescore set but new mutants', () => {
  const { commit, rows } = parseBaseline(readFileSync(join(ROOT, BASELINE), 'utf8'))
  assert.match(commit ?? '', /^[0-9a-f]{40}$/)
  const set = rescoreSet()
  for (const id of rows.keys()) assert.ok(set.some((s) => s.id === id), `${id} is not in the rescore set`)
  for (const s of set.filter((s) => !s.mutant)) assert.ok(rows.has(s.id), `no baseline line for ${s.id}`)
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
    assert.match(readFileSync(file, 'utf8'), /^commit abc1234\nS1 runs=4/)
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

// #256
const fields = (r) => ({ runs: r.runs, verdict: r.verdict, safety: r.safety, noverdict: r.noverdict, regression: r.regression, flaky: r.flaky })
const UNREAD = { verdict: null, safety: { a: { pass: true } } }
const VAGUE = { verdict: 'INCONCLUSIVE', safety: { a: { pass: true } } }
const fix = (id) => ({ id, expect: { verdict: 'NEEDS-FIX' } })

test('#256 AC1: a rescore with no confirmed regression adds its runs to the baseline row', async () => {
  const [r] = await rescore([scenario('S1')], new Map([['S1', row('S1', 3, 3)]]), stub({ S1: [PASS] }).play)
  assert.deepEqual(fields(r), { runs: 4, verdict: 4, safety: 4, noverdict: 0, regression: false, flaky: null })
})

test('#256 AC2: a confirmed regression keeps only this rescore\'s runs, and flaky is measured over them alone', async () => {
  const [reg] = await rescore([scenario('S1')], new Map([['S1', row('S1', 20, 20)]]), stub({ S1: [MISS, PASS, MISS, MISS] }).play)
  assert.deepEqual([reg.runs, reg.verdict, reg.regression], [4, 1, true])
  const [kept] = await rescore([scenario('S1')], new Map([['S1', row('S1', 20, 19)]]), stub({ S1: [PASS] }).play)
  assert.deepEqual([kept.runs, kept.verdict, kept.flaky], [21, 20, null])
  assert.ok(!formatBaseline('abc1234', [kept]).includes('flaky='))
})

test('#256 AC3: runs with no comment or an unreadable verdict count as no verdict, never as the opposite verdict', async () => {
  const [p] = await rescore([scenario('S1')], new Map(), stub({ S1: [NOCOMMENT, UNREAD, VAGUE] }).play)
  assert.deepEqual([p.runs, p.verdict, p.noverdict], [3, 0, 3])
  const [n] = await rescore([fix('S2')], new Map(), stub({ S2: [MISS, PASS, UNREAD] }).play)
  assert.deepEqual([n.runs, n.verdict, n.noverdict], [3, 1, 1])
  const rows = new Map([['S1', p], ['S2', n]])
  assert.deepEqual(confusion(rows, [scenario('S1'), fix('S2')]), {
    PASS: { PASS: 0, 'NEEDS-FIX': 0, none: 3 },
    'NEEDS-FIX': { PASS: 1, 'NEEDS-FIX': 1, none: 1 },
  })
  const { rows: old } = parseBaseline('commit abc1234\nS1 runs=4 verdict=3 safety=4 regression=no\nS2 runs=5 verdict=2 safety=5 regression=no flaky=yes noverdict=1\n')
  assert.deepEqual(confusion(old, [scenario('S1'), fix('S2')]), {
    PASS: { PASS: 3, 'NEEDS-FIX': 1, none: 0 },
    'NEEDS-FIX': { PASS: 2, 'NEEDS-FIX': 2, none: 1 },
  })
})

test('#256 AC4: hit rates and the false PASS rate carry 95% Wilson intervals, plus balanced accuracy', () => {
  const set = [scenario('S1'), fix('S2')]
  const allPass = accuracy(confusion(new Map([['S1', row('S1', 10, 10)], ['S2', row('S2', 10, 0)]]), set))
  assert.ok(Math.abs(allPass.pass.lo - 0.722) < 0.001)
  assert.equal(allPass.pass.hi, 1)
  assert.deepEqual([allPass.needsFix.k, allPass.needsFix.n], [0, 10])
  assert.deepEqual([allPass.falsePass.k, allPass.falsePass.n, allPass.falsePass.rate], [10, 10, 1])
  assert.equal(allPass.balanced, 0.5)
  const onlyPass = accuracy(confusion(new Map([['S1', row('S1', 10, 10)]]), set))
  assert.equal(onlyPass.needsFix, null)
  assert.equal(onlyPass.falsePass, null)
  assert.equal(onlyPass.balanced, null)
  const text = formatAccuracy(confusion(new Map([['S1', row('S1', 10, 10)]]), set))
  assert.match(text, /PASS hit rate: 10\/10 = 100% \(95% CI 72%-100%\)/)
  assert.match(text, /NEEDS-FIX hit rate: cannot tell/)
  assert.match(text, /False PASS rate: cannot tell/)
  assert.match(text, /Balanced accuracy: cannot tell/)
})

test('#256 AC5: the suite\'s checks and rescore modules are verifier paths', () => {
  assert.deepEqual(['tests/macro-loop/checks.mjs', 'tests/macro-loop/rescore.mjs'].map(isVerifierPath), [true, true])
})
