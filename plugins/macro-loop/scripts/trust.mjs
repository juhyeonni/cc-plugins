#!/usr/bin/env node
// Decides trust for the macro-loop skills the same way every time (#39): the config on
// the default branch over the init template's defaults, the trusted logins, and, when
// asked, an Issue's spec comment and a PR's author, last verdict (its id, result and the
// head SHA it judged, null for a verdict written before the SHA was recorded) and round.
//
//   node trust.mjs [--issue <n>] [--pr <n>]
//
// With --pr alone, the Issue is the one the PR's body closes.
//
// Run it in the repo's checkout: `gh` fills in {owner}/{repo} from there. It prints one
// JSON object on one line. On any failure it prints nothing and exits non-zero.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const SPEC = '<!-- macro-loop:spec -->'
const VERDICT = '<!-- macro-loop:verify round='
const TEMPLATE = new URL('../skills/init/templates/macro-loop.json', import.meta.url)
const CONFIG = 'repos/{owner}/{repo}/contents/.github/macro-loop.json'

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

function decide(argv) {
  const { values } = parseArgs({ args: argv, options: { issue: { type: 'string' }, pr: { type: 'string' } } })
  const issue = values.issue && number('issue', values.issue)
  const pr = values.pr && number('pr', values.pr)

  const file = readConfig()
  const config = merge(JSON.parse(readFileSync(TEMPLATE, 'utf8')), file ?? {})
  if (!Array.isArray(config.trusted)) throw new Error('`trusted` in .github/macro-loop.json must be a list of logins')
  const me = api(['user']).login
  const owner = api(['repos/{owner}/{repo}']).owner
  // Who is trusted (reference/github.md): you, plus the list, or without one the owner when a person owns the repo.
  const others = config.trusted.length > 0 ? config.trusted : owner.type === 'User' ? [owner.login] : []
  const trusted = [...new Set([me, ...others].map(lower))]
  const trustedMarked = (n, marker) =>
    api(['--paginate', '--slurp', `repos/{owner}/{repo}/issues/${n}/comments`])
      .flat()
      .filter((c) => trusted.includes(lower(c.user?.login)) && String(c.body ?? '').startsWith(marker))

  const out = { configFile: file !== null, config, trusted }
  let issueNumber = issue
  if (pr) {
    const p = api([`repos/{owner}/{repo}/pulls/${pr}`])
    // The Issue a PR implements is the one its body closes (`Closes #<n>`, see verify).
    const closes = Number(/^\s*closes\s+#(\d+)\b/im.exec(p.body ?? '')?.[1]) || null
    const verdicts = trustedMarked(pr, VERDICT)
    out.pr = {
      number: Number(pr),
      author: p.user.login,
      authorTrusted: trusted.includes(lower(p.user.login)),
      head: p.head.sha,
      base: p.base.ref,
      closes,
      lastVerdict: verdicts.at(-1)?.id ?? null,
      lastVerdictResult: /^## Verify: (PASS|NEEDS-FIX)\b/m.exec(verdicts.at(-1)?.body ?? '')?.[1] ?? null,
      lastVerdictSha: /^<!-- macro-loop:verify round=\d+ sha=([0-9a-f]{7,40}) -->/.exec(verdicts.at(-1)?.body ?? '')?.[1] ?? null,
      round: verdicts.length + 1,
    }
    issueNumber ||= closes && String(closes)
  }
  if (issueNumber) out.issue = { number: Number(issueNumber), spec: trustedMarked(issueNumber, SPEC).at(-1)?.id ?? null }
  return out
}

try {
  process.stdout.write(`${JSON.stringify(decide(process.argv.slice(2)))}\n`)
} catch (e) {
  process.stderr.write(`trust.mjs: ${e.message}\n`)
  process.exitCode = 1
}
