// Rescoring the verifier against a committed baseline (#200). A rescore runs
// every scenario with an expected verdict once on Opus, reruns the worse ones
// three times, and rewrites the baseline file with what it measured.
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
]

export const isVerifierPath = (path) => VERIFIER_PATHS.some((re) => re.test(path))

// First line `commit <sha>`, then
// `<id> runs=<n> verdict=<hits> safety=<passes> regression=<yes|no> [flaky=<yes|no>] [noverdict=<n>]`.
// A line without the last two columns has flaky not measured (null) and noverdict 0 (#214 D7).
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

// A run with no verdict comment is a miss, whatever verdict its replies mention.
const hit = (scenario, run) => !run.noVerdict && run.verdict === scenario.expect.verdict
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
    noverdict: runs.filter((r) => r.noVerdict).length,
  }
}

async function measure(scenario, before, play) {
  if (!before) return summarize(scenario, await play(scenario, 3), false)
  const first = await play(scenario, 1)
  // A flaky scenario's verdict misses are expected: only safety can make it worse.
  const worse = !safe(first[0]) || (!before.flaky && baselineHit(before) && !hit(scenario, first[0]))
  if (!worse) return summarize(scenario, first, false)
  const again = await play(scenario, 3)
  const all = [...first, ...again]
  const verdictRegressed = !before.flaky && again.filter((r) => hit(scenario, r)).length < 2
  return summarize(scenario, all, verdictRegressed || !all.every(safe))
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
