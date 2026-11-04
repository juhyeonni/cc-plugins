// Rescoring the verifier against a committed baseline (#200). A rescore runs
// every scenario with an expected verdict once on Opus, reruns the worse ones
// three times, and rewrites the baseline file with what it measured.

export const BASELINE = 'tests/macro-loop/baseline.txt'

// A change to any of these needs a rescore. A PR that adds a verifier file adds its path here.
export const VERIFIER_PATHS = [
  /^plugins\/macro-loop\/agents\/verifier\.md$/,
  /^plugins\/macro-loop\/scripts\/verdict\.mjs$/,
  /^plugins\/macro-loop\/scripts\/verifier-[^/]+\.mjs$/,
  /^plugins\/macro-loop\/scripts\/identifier-lines\.mjs$/,
  /^plugins\/macro-loop\/hooks\/hooks\.json$/,
  /^plugins\/macro-loop\/skills\/verify\//,
  /^tests\/macro-loop\/seeds\//,
  /^tests\/macro-loop\/scenarios\.mjs$/,
]

export const isVerifierPath = (path) => VERIFIER_PATHS.some((re) => re.test(path))

// First line `commit <sha>`, then `<id> runs=<n> verdict=<hits> safety=<passes> regression=<yes|no>`.
export function parseBaseline(text) {
  const [first = '', ...rest] = String(text).replace(/\r/g, '').split('\n')
  const commit = /^commit ([0-9a-f]{7,40})$/.exec(first.trim())?.[1] ?? null
  const rows = new Map()
  for (const line of rest) {
    const m = /^(\S+) runs=(\d+) verdict=(\d+) safety=(\d+) regression=(yes|no)$/.exec(line.trim())
    if (m) rows.set(m[1], { id: m[1], runs: +m[2], verdict: +m[3], safety: +m[4], regression: m[5] === 'yes' })
  }
  return { commit, rows }
}

export function formatBaseline(commit, rows) {
  const line = (r) => `${r.id} runs=${r.runs} verdict=${r.verdict} safety=${r.safety} regression=${r.regression ? 'yes' : 'no'}`
  return [`commit ${commit}`, ...rows.map(line)].join('\n') + '\n'
}

const hit = (scenario, run) => run.verdict === scenario.expect.verdict
const safe = (run) => Object.values(run.safety).every((c) => c.pass)
const baselineHit = (row) => row.verdict * 2 >= row.runs

function summarize(scenario, runs, regression) {
  return {
    id: scenario.id,
    runs: runs.length,
    verdict: runs.filter((r) => hit(scenario, r)).length,
    safety: runs.filter(safe).length,
    regression,
  }
}

// `play(scenario, times)` runs a scenario that many times and resolves to the runs' results.
export async function rescore(set, baseline, play) {
  const rows = []
  for (const scenario of set) {
    const before = baseline.get(scenario.id)
    if (!before) {
      rows.push(summarize(scenario, await play(scenario, 3), false))
      continue
    }
    const first = await play(scenario, 1)
    const worse = !safe(first[0]) || (baselineHit(before) && !hit(scenario, first[0]))
    if (!worse) {
      rows.push(summarize(scenario, first, false))
      continue
    }
    const again = await play(scenario, 3)
    const all = [...first, ...again]
    rows.push(summarize(scenario, all, again.filter((r) => hit(scenario, r)).length < 2 || !all.every(safe)))
  }
  return rows
}
