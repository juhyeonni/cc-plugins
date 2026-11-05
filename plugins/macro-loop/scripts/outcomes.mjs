#!/usr/bin/env node
// How verify's verdicts turn out (#195): rounds to pass, merged PRs left unverified or merged
// on a stale or NEEDS-FIX verdict, and PASS PRs later reverted or found to have missed a bug.
//
//   node outcomes.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--table]
//
// Run it in the repo's checkout, like status.mjs. It reads only. It prints one JSON line; every
// share is `{count, of}`. Data it cannot read goes under `cannotTell`, never into a count (#195 D14).
// --table adds `table`, one row per PR read, with `cannot tell` for a value it cannot read (#214).
// On any failure it prints nothing and exits non-zero with the error.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { api, list } from './stage.mjs'
import { CLOSES, prState, trustContext } from './trust.mjs'

// Each PR costs one comments call (ADR-0011), so only the most recently closed are read.
const LIMIT = 100
const VERDICT = '<!-- macro-loop:verify round='
const MISSED = /^<!-- macro-loop:missed pr=(\d+) -->/
const REVERTS_COMMIT = /This reverts commit ([0-9a-f]{7,40})/g
const REVERTS_PR = /^\s*Reverts\s+([\w.-]+\/[\w.-]+)#(\d+)\b/gim

const lower = (login) => String(login ?? '').toLowerCase()
const share = (count, of) => ({ count, of })
const day = (p) => (p.merged_at ?? p.closed_at).slice(0, 10)
const byTrusted = (trusted) => (c) => trusted.includes(lower(c.user?.login))

// The result of each trusted verdict, oldest first; null for one whose heading cannot be read.
const results = (comments, trusted) =>
  comments
    .filter((c) => byTrusted(trusted)(c) && String(c.body ?? '').startsWith(VERDICT))
    .map((c) => /^## Verify: (PASS|NEEDS-FIX)\b/m.exec(c.body)?.[1] ?? null)

// D2: rounds count NEEDS-FIX verdicts before the first PASS.
function rounds(seq) {
  const pass = seq.indexOf('PASS')
  const before = pass < 0 ? seq : seq.slice(0, pass)
  const needsFix = before.filter((r) => r === 'NEEDS-FIX').length
  return { round1: pass >= 0 && needsFix === 0, round3: needsFix >= 2, reverified: pass >= 0 && pass < seq.length - 1 }
}

export function outcomes({ prs, repo, trusted, since, until, limit = LIMIT, table = false, commentsOf, commits, prsOfCommit, missedIssues }) {
  const inWindow = prs
    .filter((p) => p.closed_at && (!since || day(p) >= since) && (!until || day(p) <= until))
    .sort((a, b) => (b.merged_at ?? b.closed_at).localeCompare(a.merged_at ?? a.closed_at))
  const read = inWindow.slice(0, limit).map((p) => {
    const comments = commentsOf(p.number)
    return { p, seq: results(comments, trusted), state: prState(p, comments, trusted) }
  })
  const cannotTell = { verdictResult: [], verdictSha: [], revertSha: [], missedMarker: [] }

  const verified = read.filter((r) => r.seq.length > 0)
  for (const r of verified) if (r.seq.includes(null)) cannotTell.verdictResult.push(r.p.number)
  const counted = verified.filter((r) => !r.seq.includes(null)).map((r) => ({ ...r, ...rounds(r.seq) }))

  const merged = read.filter((r) => r.p.merged_at)
  const mergedVerified = merged.filter((r) => r.seq.length > 0)
  const unverified = merged.filter((r) => r.seq.length === 0)
  const withSha = mergedVerified.filter((r) => r.state.lastVerdictSha !== null)
  for (const r of mergedVerified) if (r.state.lastVerdictSha === null) cannotTell.verdictSha.push(r.p.number)
  const mergedPass = new Map(mergedVerified.filter((r) => r.state.lastVerdictResult === 'PASS').map((r) => [r.p.number, r]))
  const mergedNumbers = new Set(merged.map((r) => r.p.number))

  // D15: a revert names a commit of the PR, or the PR itself in a merged PR's body.
  const reverted = new Set()
  const ownPr = new Map(prs.filter((p) => p.merge_commit_sha).map((p) => [p.merge_commit_sha, p.number]))
  for (const c of commits) {
    for (const [, sha] of String(c.commit?.message ?? '').matchAll(REVERTS_COMMIT)) {
      const own = [...ownPr].find(([merge]) => merge.startsWith(sha))?.[1]
      const numbers = own ? [own] : prsOfCommit(sha)
      if (!numbers.length) cannotTell.revertSha.push(sha)
      for (const n of numbers) reverted.add(n)
    }
  }
  for (const p of prs.filter((x) => x.merged_at)) {
    for (const [, name, n] of String(p.body ?? '').matchAll(REVERTS_PR)) if (lower(name) === lower(repo)) reverted.add(Number(n))
  }

  // D11, D13: a missed bug points at its PR through a trusted marker comment.
  const missedPrs = new Set()
  let missedPass = 0
  let missedUnverified = 0
  for (const issue of missedIssues) {
    const marker = commentsOf(issue.number).filter(byTrusted(trusted)).map((c) => MISSED.exec(String(c.body ?? ''))).filter(Boolean).at(-1)
    if (!marker) {
      cannotTell.missedMarker.push(issue.number)
      continue
    }
    const n = Number(marker[1])
    missedPrs.add(n)
    if (!mergedNumbers.has(n)) continue
    if (mergedPass.has(n)) missedPass++
    else missedUnverified++
  }

  const out = {
    window: { since: since ?? null, until: until ?? null },
    read: read.length,
    rounds: {
      passedRound1: share(counted.filter((r) => r.round1).length, counted.length),
      reachedRound3: share(counted.filter((r) => r.round3).length, counted.length),
      reverifiedAfterPass: share(counted.filter((r) => r.reverified).length, counted.length),
      notMerged: counted.filter((r) => !r.p.merged_at).length,
    },
    noVerdict: { ...share(unverified.length, merged.length), noCloses: unverified.filter((r) => !CLOSES.test(r.p.body ?? '')).length },
    mergedOnNeedsFix: share(mergedVerified.filter((r) => r.state.lastVerdictResult === 'NEEDS-FIX').length, mergedVerified.length),
    staleVerdict: share(withSha.filter((r) => r.state.lastVerdictSha !== r.state.head).length, withSha.length),
    revertedPass: share([...mergedPass.keys()].filter((n) => reverted.has(n)).length, mergedPass.size),
    missedPass: share(missedPass, mergedPass.size),
    missedUnverified,
    cannotTell,
  }
  const withTable = table ? { ...out, table: read.map((r) => tableRow(r, { reverted, missedPrs, cannotTell })) } : out
  return inWindow.length > limit ? { ...withTable, more: inWindow.length - limit } : withTable
}

const CANNOT_TELL = 'cannot tell'
const yesNo = (b) => (b ? 'yes' : 'no')

// One PR as a table row. An unmerged PR has no stale, reverted or missed to read: `n/a`. A revert or a
// missed marker that points at no PR could be this one, so a merged PR not known to be hit cannot tell.
function tableRow({ p, seq, state }, { reverted, missedPrs, cannotTell }) {
  const merged = Boolean(p.merged_at)
  const known = (set, unreadable) => (set.has(p.number) ? 'yes' : unreadable ? CANNOT_TELL : 'no')
  return {
    pr: p.number,
    result: seq.length === 0 ? 'no verdict' : (seq.at(-1) ?? CANNOT_TELL),
    merged: yesNo(merged),
    stale: !merged || seq.length === 0 ? 'n/a' : state.lastVerdictSha === null ? CANNOT_TELL : yesNo(state.lastVerdictSha !== state.head),
    reverted: merged ? known(reverted, cannotTell.revertSha.length > 0) : 'n/a',
    missed: merged ? known(missedPrs, cannotTell.missedMarker.length > 0) : 'n/a',
  }
}

// The commit-to-PR endpoint answers 422 for a SHA GitHub does not know: that is "no PR", not a failure.
function prsOfCommit(sha) {
  const r = spawnSync('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/pulls`], { encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) {
    if (/HTTP (404|422)/.test(r.stderr)) return []
    throw new Error(`gh api repos/{owner}/{repo}/commits/${sha}/pulls failed: ${r.stderr.trim()}`)
  }
  return JSON.parse(r.stdout).filter((p) => p.merged_at).map((p) => p.number)
}

function date(flag, value) {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${flag} takes a date as YYYY-MM-DD, not ${JSON.stringify(value)}`)
  return value
}

function decide(argv) {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string' }, until: { type: 'string' }, table: { type: 'boolean' } } })
  const since = date('since', values.since)
  const until = date('until', values.until)
  const { config, trusted, defaultBranch } = trustContext()
  const repo = api(['repos/{owner}/{repo}']).full_name
  // A revert comes after the PR it reverts, so commits before --since cannot revert one in the window.
  const commits = list(`repos/{owner}/{repo}/commits?sha=${defaultBranch}&per_page=100${since ? `&since=${since}T00:00:00Z` : ''}`)
  const missedIssues = list(`repos/{owner}/{repo}/issues?state=all&labels=${encodeURIComponent(config.labels.missed)}&per_page=100`).filter((i) => !i.pull_request)
  return outcomes({
    prs: list('repos/{owner}/{repo}/pulls?state=closed&per_page=100'),
    repo,
    trusted,
    since,
    until,
    table: values.table,
    commentsOf: (n) => list(`repos/{owner}/{repo}/issues/${n}/comments`),
    commits,
    prsOfCommit,
    missedIssues,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(decide(process.argv.slice(2)))}\n`)
  } catch (e) {
    process.stderr.write(`outcomes.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
