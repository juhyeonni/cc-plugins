#!/usr/bin/env node
// Lists what needs attention across the repo's open Issues and PRs (#78): for each Issue,
// the stage stage.mjs gives it, sorted so what a person must do comes first.
//
//   node status.mjs
//
// Run it in the repo's checkout, like stage.mjs. It reads only. It prints one JSON line per
// Issue, and per PR that closes no Issue, then `{"more": <count>}` when Issues were left out.
// On any failure it prints nothing and exits non-zero with the error.
import { fileURLToPath } from 'node:url'
import { list, runContext, stageOfIssue } from './stage.mjs'
import { CLOSES } from './trust.mjs'

// Each Issue costs one or two gh calls on top of the run's few shared ones, so only the
// most recently updated Issues are checked.
const LIMIT = 30

const rank = (row) => (row.stage === 'resumable' ? 0 : row.gate ? 1 : 2)

export function statusLines({ issues, prs, stageFor, limit = LIMIT }) {
  const recent = [...issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const checked = recent.slice(0, limit).map((i) => {
    let result
    try {
      result = stageFor(i)
    } catch (e) {
      result = { stage: 'error', why: e.message, gate: true }
    }
    return { kind: 'issue', number: i.number, title: i.title, ...result, updated: i.updated_at }
  })
  const unlinked = prs
    .filter((p) => !CLOSES.test(p.body ?? ''))
    .map((p) => ({ kind: 'pr', number: p.number, title: p.title, stage: 'unlinked-pr', why: 'no "Closes #<n>" line in the PR body', gate: true, updated: p.updated_at }))
  const rows = [...checked, ...unlinked]
    .filter((row) => row.stage !== 'done')
    .sort((a, b) => rank(a) - rank(b) || a.updated.localeCompare(b.updated))
  return recent.length > limit ? [...rows, { more: recent.length - limit }] : rows
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const issues = list('repos/{owner}/{repo}/issues?state=open&per_page=100').filter((i) => !i.pull_request)
    const ctx = runContext()
    const prs = ctx.prs.filter((p) => p.state === 'open')
    const lines = statusLines({ issues, prs, stageFor: (i) => stageOfIssue(i.number, i, ctx) })
    process.stdout.write(lines.map((row) => `${JSON.stringify(row)}\n`).join(''))
  } catch (e) {
    process.stderr.write(`status.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
