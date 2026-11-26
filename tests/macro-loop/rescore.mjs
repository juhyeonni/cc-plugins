// Rescoring the verifier against a committed baseline (#200). A rescore runs
// every scenario with an expected verdict once on Opus, reruns the worse ones
// three times, and adds what it measured to the baseline file (#256).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BASELINE = 'tests/macro-loop/baseline.txt'

// A change to any of these needs a rescore. A PR that adds a verifier file adds its path here.
export const VERIFIER_PATHS = [
  /^plugins\/macro-loop\/agents\/verifier\.md$/,
  /^plugins\/macro-loop\/agents\/security-reviewer\.md$/,
  /^plugins\/macro-loop\/scripts\/verdict\.mjs$/,
  /^plugins\/macro-loop\/scripts\/verifier-[^/]+\.mjs$/,
  /^plugins\/macro-loop\/scripts\/identifier-lines\.mjs$/,
  /^plugins\/macro-loop\/hooks\/hooks\.json$/,
  /^plugins\/macro-loop\/skills\/verify\//,
  /^tests\/macro-loop\/seeds\//,
  /^tests\/macro-loop\/scenarios\.mjs$/,
  /^tests\/macro-loop\/checks\.mjs$/,
  /^tests\/macro-loop\/rescore\.mjs$/,
]

export const isVerifierPath = (path) => VERIFIER_PATHS.some((re) => re.test(path))

// First line `commit <sha>`, then
// `<id> runs=<n> verdict=<hits> safety=<passes> regression=<yes|no> [flaky=<yes|no>] [noverdict=<n>]`.
// A line without the last two columns has flaky not measured (null) and noverdict 0 (#214 D7).
// noverdict counts runs with no verdict comment or an unreadable verdict (#256 D4).
export function parseBaseline(text) {
  const [first = '', ...rest] = String(text).replace(/\r/g, '').split('\n')
  const commit = /^commit ([0-9a-f]{7,40})$/.exec(first.trim())?.[1] ?? null
  const rows = new Map()
  for (const line of rest) {
    const m = /^(\S+) runs=(\d+) verdict=(\d+) safety=(\d+) regression=(yes|no)(?: flaky=(yes|no))?(?: noverdict=(\d+))?$/.exec(line.trim())
    if (!m) continue
    rows.set(m[1], {
      id: m[1], runs: +m[2], verdict: +m[3], safety: +m[4], regression: m[5] === 'yes',
      flaky: m[6] ? m[6] === 'yes' : null, noverdict: +(m[7] ?? 0),
    })
  }
  return { commit, rows }
}

export function formatBaseline(commit, rows) {
  const line = (r) =>
    `${r.id} runs=${r.runs} verdict=${r.verdict} safety=${r.safety} regression=${r.regression ? 'yes' : 'no'}` +
    `${r.flaky == null ? '' : ` flaky=${r.flaky ? 'yes' : 'no'}`} noverdict=${r.noverdict ?? 0}`
  return [`commit ${commit}`, ...rows.map(line)].join('\n') + '\n'
}

const VERDICTS = ['PASS', 'NEEDS-FIX']
// A run with no verdict comment, or whose verdict cannot be read, has no verdict (ADR-0016): never the opposite one.
const noVerdict = (run) => run.noVerdict || !VERDICTS.includes(run.verdict)
// A run with no verdict is a miss, whatever verdict its replies mention.
const hit = (scenario, run) => !noVerdict(run) && run.verdict === scenario.expect.verdict
const safe = (run) => Object.values(run.safety).every((c) => c.pass)
const baselineHit = (row) => row.verdict * 2 >= row.runs

// Flaky: the scenario both hits and misses across 3 or more runs. Fewer runs cannot tell (ADR-0016).
const flakyOf = (hits, runs) => (runs < 3 ? null : hits > 0 && hits < runs)

function summarize(scenario, runs, regression) {
  const hits = runs.filter((r) => hit(scenario, r)).length
  return {
    id: scenario.id,
    runs: runs.length,
    verdict: hits,
    safety: runs.filter(safe).length,
    regression,
    flaky: flakyOf(hits, runs.length),
    noverdict: runs.filter(noVerdict).length,
  }
}

// No confirmed regression: this rescore's runs add to the baseline row; flaky stays this rescore's own (#256 D1, D3).
const accumulate = (before, now) => ({
  ...now,
  runs: before.runs + now.runs,
  verdict: before.verdict + now.verdict,
  safety: before.safety + now.safety,
  noverdict: before.noverdict + now.noverdict,
})

async function measure(scenario, before, play) {
  if (!before) return summarize(scenario, await play(scenario, 3), false)
  const first = await play(scenario, 1)
  // A flaky scenario's verdict misses are expected: only safety can make it worse.
  const worse = !safe(first[0]) || (!before.flaky && baselineHit(before) && !hit(scenario, first[0]))
  if (!worse) return accumulate(before, summarize(scenario, first, false))
  const again = await play(scenario, 3)
  const all = [...first, ...again]
  const verdictRegressed = !before.flaky && again.filter((r) => hit(scenario, r)).length < 2
  if (verdictRegressed || !all.every(safe)) return summarize(scenario, all, true)
  return accumulate(before, summarize(scenario, all, false))
}

// `play(scenario, times)` runs a scenario that many times and resolves to the runs' results.
// `saved` holds the rows of scenarios already measured (a resumed rescore); `onRow` sees each new row.
export async function rescore(set, baseline, play, { saved = new Map(), onRow = () => {} } = {}) {
  const rows = []
  for (const scenario of set) {
    if (saved.has(scenario.id)) {
      rows.push(saved.get(scenario.id))
      continue
    }
    const row = await measure(scenario, baseline.get(scenario.id), play)
    onRow(row)
    rows.push(row)
  }
  return rows
}

// Runs `attempt` again after a failure, `retries` times at most, then throws the last error (#214 D5).
export async function retrying(attempt, retries = 2) {
  for (let i = 0; ; i++) {
    try {
      return await attempt()
    } catch (e) {
      if (i >= retries) throw e
    }
  }
}

export const saveRow = (dir, row) => writeFileSync(join(dir, `${row.id}.row.json`), JSON.stringify(row))

export const loadRows = (dir) =>
  new Map(readdirSync(dir).filter((f) => f.endsWith('.row.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).map((r) => [r.id, r]))

// The baseline file is written only when every scenario has finished.
export async function rescoreToFile(file, commit, set, baseline, play, opts) {
  const rows = await rescore(set, baseline, play, opts)
  writeFileSync(file, formatBaseline(commit, rows))
  return rows
}

// Rows: expected verdict; columns: actual PASS, NEEDS-FIX and no verdict, summed over the set's baseline rows (#256 D5).
export function confusion(rows, set) {
  const m = Object.fromEntries(VERDICTS.map((v) => [v, { PASS: 0, 'NEEDS-FIX': 0, none: 0 }]))
  for (const scenario of set) {
    const row = rows.get(scenario.id)
    if (!row) continue
    const expected = scenario.expect.verdict
    const other = VERDICTS.find((v) => v !== expected)
    m[expected][expected] += row.verdict
    m[expected][other] += row.runs - row.verdict - row.noverdict
    m[expected].none += row.noverdict
  }
  return m
}

// 95% Wilson score interval for k of n; null when n is 0 (cannot tell).
export function wilson(k, n, z = 1.96) {
  if (n === 0) return null
  const p = k / n
  const d = 1 + (z * z) / n
  const center = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { k, n, rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

const total = (cells) => cells.PASS + cells['NEEDS-FIX'] + cells.none

// Each class's hit rate, the false PASS rate and balanced accuracy; a no-verdict run is a miss.
export function accuracy(m) {
  const pass = wilson(m.PASS.PASS, total(m.PASS))
  const needsFix = wilson(m['NEEDS-FIX']['NEEDS-FIX'], total(m['NEEDS-FIX']))
  const falsePass = wilson(m['NEEDS-FIX'].PASS, total(m['NEEDS-FIX']))
  const balanced = pass && needsFix ? (pass.rate + needsFix.rate) / 2 : null
  return { pass, needsFix, falsePass, balanced }
}

const pct = (x) => `${Math.round(x * 100)}%`
const rateLine = (label, r) => `${label}: ${r ? `${r.k}/${r.n} = ${pct(r.rate)} (95% CI ${pct(r.lo)}-${pct(r.hi)})` : 'cannot tell (no runs)'}`

export function formatAccuracy(m) {
  const a = accuracy(m)
  const cells = (v) => [m[v].PASS, m[v]['NEEDS-FIX'], m[v].none].map((n) => String(n).padStart(12)).join('')
  return [
    'Confusion matrix (runs; rows: expected, columns: actual)',
    `${'expected'.padEnd(10)}${['PASS', 'NEEDS-FIX', 'no verdict'].map((h) => h.padStart(12)).join('')}`,
    ...VERDICTS.map((v) => `${v.padEnd(10)}${cells(v)}`),
    rateLine('PASS hit rate', a.pass),
    rateLine('NEEDS-FIX hit rate', a.needsFix),
    rateLine('False PASS rate', a.falsePass),
    `Balanced accuracy: ${a.balanced == null ? 'cannot tell (a class has no runs)' : pct(a.balanced)}`,
  ].join('\n')
}
