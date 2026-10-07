#!/usr/bin/env node
// Picks the Issues `execute` runs (#111) and renders its report. Which Issues run, and from
// which stage, is decided here in code, from the stages stage.mjs gives (#39).
//
//   node execute.mjs [<n> ...]      the candidates, as one JSON line: {run, left}
//   node execute.mjs --report <file> the report table for the results in <file> (JSON)
//
// Run it in the repo's checkout, like status.mjs. It reads only. On any failure it prints
// nothing and exits non-zero with the error.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { api, findPr, list, runContext, stageOfIssue } from './stage.mjs'
import { prState, specOf } from './trust.mjs'
import { statusLines } from './status.mjs'

// The stages a machine can carry on without a person.
export const START = ['implement', 'open-pr', 'verify']
const UNTRUSTED = 'the PR author is not trusted: verify it with /macro-loop:verify'

const lower = (login) => String(login ?? '').toLowerCase()

// rows: {number, stage, why, prAuthor}. given: Issue numbers in the order the user named them.
export function candidates(rows, { trusted, given = null }) {
  const by = new Map(rows.map((r) => [r.number, r]))
  const picked = given ? given.map((n) => by.get(n) ?? { number: n, stage: null }) : rows.filter((r) => START.includes(r.stage))
  const run = []
  const left = []
  for (const r of picked) {
    if (r.stage === null) left.push({ number: r.number, stage: null, reason: 'not an open Issue that status checked' })
    else if (!START.includes(r.stage)) left.push({ number: r.number, stage: r.stage, reason: `stage ${r.stage} needs a person: ${r.why}` })
    else if (r.prAuthor && !trusted.includes(lower(r.prAuthor))) left.push({ number: r.number, stage: r.stage, reason: UNTRUSTED })
    else run.push({ ...r, start: r.stage })
  }
  return { run, left }
}

// The commands a spec's `check: cmd` criteria name, in order.
export const specCommands = (body) => [...String(body ?? '').matchAll(/check: cmd `([^`]+)`/g)].map((m) => m[1])

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

function person(e) {
  if (e.left) return `Left out: ${e.left}`
  const failed = [e.implement, e.openPr].find((s) => s && !s.ok)
  if (failed) return 'Read why and decide'
  const v = e.verify?.verdict
  if (v === 'PASS') return 'Read the verdict, mark the draft PR "Ready for review", then merge it'
  if (v === 'NEEDS-FIX') return `Read the verdict, then run \`/macro-loop:execute ${e.number}\` to fix it`
  if (v === 'INCONCLUSIVE') return 'Fix what kept the checks from running, then verify again'
  return 'Read why and decide'
}

const done = (s, ok) => (s ? (s.ok ? `✓ ${ok(s)}` : `✗ ${s.reason}`) : '·')

// entries: {number, start, implement?, openPr?, verify?, left?}; a stage before `start` did not run.
export function report(entries) {
  const head = ['| Issue | implement | open-pr | verify | What a person does |', '|---|---|---|---|---|']
  const rows = entries.map((e) => {
    const before = (stage) => e.start && START.indexOf(stage) < START.indexOf(e.start)
    const impl = before('implement') ? 'not run' : done(e.implement, (s) => s.branch)
    const pr = before('open-pr') ? 'not run' : done(e.openPr, (s) => `PR #${s.pr}`)
    const ver = e.verify ? (e.verify.verdict === 'PASS' ? '✓ PASS' : `✗ ${e.verify.verdict}`) : '·'
    return `| #${e.number} | ${[impl, pr, ver, person(e)].map(cell).join(' | ')} |`
  })
  return `${[...head, ...rows].join('\n')}\n`
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

// The local branch `implement` made for Issue n: named <n>-*, newest first.
const branchOf = (n) => git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', `refs/heads/${n}-*`]).split('\n').filter(Boolean)[0] ?? null

function decide(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { report: { type: 'string' } }, allowPositionals: true })
  if (values.report) return report(JSON.parse(readFileSync(values.report, 'utf8')))
  if (!positionals.every((p) => /^#?\d+$/.test(p))) throw new Error('Issue numbers only, such as 61 or #61')
  const given = positionals.length ? positionals.map((p) => Number(p.replace('#', ''))) : null

  const ctx = runContext()
  const issues = list('repos/{owner}/{repo}/issues?state=open&per_page=100').filter((i) => !i.pull_request)
  const wanted = given ? issues.filter((i) => given.includes(i.number)) : issues
  const rows = statusLines({ issues: wanted, prs: [], stageFor: (i) => stageOfIssue(i.number, i, ctx), limit: Infinity })
    .filter((r) => r.kind === 'issue')
    .map((r) => {
      const pr = findPr(r.number, ctx.prs)
      return { number: r.number, stage: r.stage, why: r.why, prAuthor: pr?.state === 'open' ? pr.user?.login : null }
    })
  const { run, left } = candidates(rows, { trusted: ctx.trusted, given })
  for (const r of run) {
    const comments = list(`repos/{owner}/{repo}/issues/${r.number}/comments`)
    r.spec = specOf(comments, ctx.trusted)
    r.commands = r.spec ? specCommands(api([`repos/{owner}/{repo}/issues/comments/${r.spec}`]).body) : []
    const pr = findPr(r.number, ctx.prs)
    if (pr?.state === 'open') {
      const s = prState(pr, list(`repos/{owner}/{repo}/issues/${pr.number}/comments`), ctx.trusted)
      r.pr = { number: pr.number, head: s.head, round: s.round, branch: pr.head.ref }
    } else r.pr = null
    r.branch = r.pr?.branch ?? branchOf(r.number)
  }
  return `${JSON.stringify({ base: ctx.defaultBranch, run, left })}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(decide(process.argv.slice(2)))
  } catch (e) {
    process.stderr.write(`execute.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
