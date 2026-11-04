#!/usr/bin/env node
// Decides trust for the macro-loop skills the same way every time (#39): the config on
// the default branch over the init template's defaults, the trusted logins, and, when
// asked, an Issue's spec comment and a PR's author, last verdict (its id, result and the
// head SHA it judged, null for a verdict written before the SHA was recorded), round and the
// answers to its findings, each with the head its round judged, and the verifiers' Answers line.
//
//   node trust.mjs [--issue <n>] [--pr <n>]
//
// With --pr alone, the Issue is the one the PR's body closes.
//
// Run it in the repo's checkout: `gh` fills in {owner}/{repo} from there. It prints one
// JSON object on one line. On any failure it prints nothing and exits non-zero.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// The line that links a PR to the Issue it implements; stage.mjs and status.mjs import it.
export const CLOSES = /^\s*closes\s+#(\d+)\b/im
// Every Issue a PR's body closes, in order.
export const closesAll = (body) => [...String(body ?? '').matchAll(new RegExp(CLOSES.source, 'gim'))].map((m) => Number(m[1]))
const SPEC = '<!-- macro-loop:spec -->'
const VERDICT = '<!-- macro-loop:verify round='
// A verdict comment's first line, as verdict.mjs writes it (the sha is missing on an older
// one), and its heading. The scenario suite's checks import these too.
export const VERDICT_MARKER = /^<!-- macro-loop:verify round=(\d+)(?: sha=([0-9a-f]{7,40}))? -->$/
export const VERDICT_HEADING = /^## Verify: (PASS|NEEDS-FIX)\b/m
export const verdictMarker = (body) => VERDICT_MARKER.exec(String(body ?? '').split(/\r?\n/)[0])
export const CONFIG_FILE = '.github/macro-loop.json'
const TEMPLATE = new URL('../skills/init/templates/macro-loop.json', import.meta.url)
const CONFIG = `repos/{owner}/{repo}/contents/${CONFIG_FILE}`

function gh(args) {
  const r = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.error) throw r.error
  return r
}

function api(args) {
  const r = gh(args)
  if (r.status !== 0) throw new Error(`gh api ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return JSON.parse(r.stdout)
}

// The contents API without a ref reads the default branch, so a list on a PR's branch
// or in the working tree has no effect. A 404 means the default branch has no file.
function readConfig() {
  const r = gh([CONFIG])
  if (r.status !== 0) {
    if (/HTTP 404/.test(r.stderr)) return null
    throw new Error(`gh api ${CONFIG} failed: ${r.stderr.trim()}`)
  }
  const text = Buffer.from(JSON.parse(r.stdout).content, 'base64').toString('utf8')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`.github/macro-loop.json on the default branch is not valid JSON: ${e.message}`)
  }
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

// A key the file sets overrides the default; a key it leaves out keeps the default.
function merge(defaults, file) {
  if (!isObject(defaults) || !isObject(file)) return file === undefined ? defaults : file
  const out = { ...defaults }
  for (const [key, value] of Object.entries(file)) out[key] = merge(defaults[key], value)
  return out
}

const lower = (login) => String(login ?? '').toLowerCase()

function number(flag, value) {
  if (!/^\d+$/.test(value)) throw new Error(`--${flag} takes a number, not ${JSON.stringify(value)}`)
  return value
}

// What is the same for every Issue and PR in a run: stage.mjs builds it once and passes it on.
export function trustContext() {
  const file = readConfig()
  const config = merge(JSON.parse(readFileSync(TEMPLATE, 'utf8')), file ?? {})
  if (!Array.isArray(config.trusted)) throw new Error('`trusted` in .github/macro-loop.json must be a list of logins')
  const me = api(['user']).login
  const repo = api(['repos/{owner}/{repo}'])
  // Who is trusted (reference/github.md): you, plus the list, or without one the owner when a person owns the repo.
  const others = config.trusted.length > 0 ? config.trusted : repo.owner.type === 'User' ? [repo.owner.login] : []
  const trusted = [...new Set([me, ...others].map(lower))]
  return { configFile: file !== null, config, trusted, defaultBranch: repo.default_branch }
}

const trustedMarked = (comments, trusted, marker) =>
  comments.filter((c) => trusted.includes(lower(c.user?.login)) && String(c.body ?? '').startsWith(marker))

export const specOf = (comments, trusted) => trustedMarked(comments, trusted, SPEC).at(-1)?.id ?? null

// `p` is a PR as the pulls API returns it, `comments` its comments.
export function prState(p, comments, trusted) {
  const verdicts = trustedMarked(comments, trusted, VERDICT)
  return {
    author: p.user.login,
    authorTrusted: trusted.includes(lower(p.user.login)),
    head: p.head.sha,
    base: p.base.ref,
    // The Issue a PR implements is the one its body closes (`Closes #<n>`, see verify).
    closes: closesAll(p.body)[0] ?? null,
    closesAll: closesAll(p.body),
    lastVerdict: verdicts.at(-1)?.id ?? null,
    lastVerdictResult: VERDICT_HEADING.exec(verdicts.at(-1)?.body ?? '')?.[1] ?? null,
    lastVerdictSha: verdictMarker(verdicts.at(-1)?.body)?.[2] ?? null,
    round: verdicts.length + 1,
  }
}

const ANSWER_MARKER = /^<!-- macro-loop:answer round=(\d+) -->$/
const ANSWER_LINE = /^- ((?:#\d+ )?[A-Z]+\d+) (wrong|intended|minor): (.*\S)\s*$/

// The head sha each round's trusted verdict judged; a verdict written without one gives none.
function verdictShas(comments, trusted) {
  const shas = new Map()
  for (const c of trustedMarked(comments, trusted, VERDICT)) {
    const m = verdictMarker(c.body)
    if (m) shas.set(Number(m[1]), m[2] ?? null)
  }
  return shas
}

// The verifiers' `Answers` identifier line (#198): each answer comment with the head its round
// judged. An answer whose round has no sha is left out, so its findings are reported again.
const answersLine = (answers) => [...new Set(answers.filter((a) => a.sha).map((a) => `${a.comment}@${a.sha}`))].join(', ') || 'none'

// Answers to verify findings (#196): a record only, never read by verdict.mjs. The later
// answer to the same round and finding wins; a line of another shape is named in a warning.
export function answersOf(comments, trusted) {
  const shas = verdictShas(comments, trusted)
  const answers = new Map()
  const warnings = []
  for (const c of trustedMarked(comments, trusted, '<!-- macro-loop:answer ')) {
    const [first, ...lines] = String(c.body).split(/\r?\n/)
    const round = ANSWER_MARKER.exec(first.trim())?.[1]
    if (!round) {
      warnings.push(`comment ${c.id}: the marker is not \`<!-- macro-loop:answer round=N -->\``)
      continue
    }
    for (const line of lines.filter((l) => l.trim())) {
      const m = ANSWER_LINE.exec(line)
      if (!m) warnings.push(`comment ${c.id}: "${line.trim()}" is not \`- <ID> <wrong|intended|minor>: <reason>\``)
      else answers.set(`${round} ${m[1]}`, { round: Number(round), id: m[1], category: m[2], reason: m[3], comment: c.id, sha: shas.get(Number(round)) ?? null })
    }
  }
  const list = [...answers.values()]
  return { answers: list, answerWarnings: warnings, answersLine: answersLine(list) }
}

const comments = (n) => api(['--paginate', '--slurp', `repos/{owner}/{repo}/issues/${n}/comments`]).flat()

function decide(argv) {
  const { values } = parseArgs({ args: argv, options: { issue: { type: 'string' }, pr: { type: 'string' } } })
  const issue = values.issue && number('issue', values.issue)
  const pr = values.pr && number('pr', values.pr)

  const { configFile, config, trusted } = trustContext()
  const out = { configFile, config, trusted }
  let issueNumber = issue
  if (pr) {
    const p = api([`repos/{owner}/{repo}/pulls/${pr}`])
    const prComments = comments(pr)
    out.pr = { number: Number(pr), ...prState(p, prComments, trusted), ...answersOf(prComments, trusted) }
    issueNumber ||= out.pr.closes && String(out.pr.closes)
  }
  if (issueNumber) out.issue = { number: Number(issueNumber), spec: specOf(comments(issueNumber), trusted) }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(decide(process.argv.slice(2)))}\n`)
  } catch (e) {
    process.stderr.write(`trust.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
