import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/macro-loop/scripts/status.mjs')
const { statusLines } = await import(pathToFileURL(SCRIPT).href)

const issue = (number, updated, over = {}) => ({ number, title: `Issue ${number}`, updated_at: updated, ...over })
const pr = (number, body, updated = '2026-10-01T00:00:00Z') => ({ number, title: `PR ${number}`, body, updated_at: updated })
const stages = (table) => (i) => {
  const r = table[i.number]
  if (r instanceof Error) throw r
  return r
}
const lines = (issues, table, prs = [], limit) => statusLines({ issues, prs, stageFor: stages(table), limit })
const row = (stage, gate = false) => ({ stage, why: stage, gate })

test('rows: one per open Issue, with number, title, stage, why, gate and updated', () => {
  const [r] = lines([issue(1, '2026-10-02T00:00:00Z')], { 1: { stage: 'implement', why: 'a spec', gate: false } })
  assert.deepEqual(r, { kind: 'issue', number: 1, title: 'Issue 1', stage: 'implement', why: 'a spec', gate: false, updated: '2026-10-02T00:00:00Z' })
})

test('rows: an Issue whose stage is done is left out', () => {
  assert.deepEqual(lines([issue(1, '2026-10-02T00:00:00Z')], { 1: row('done') }), [])
})

test('order: resumable, then gate true, then the rest; least recently updated first inside a group', () => {
  const issues = [
    issue(1, '2026-10-05T00:00:00Z'),
    issue(2, '2026-10-01T00:00:00Z'),
    issue(3, '2026-10-04T00:00:00Z'),
    issue(4, '2026-10-03T00:00:00Z'),
    issue(5, '2026-10-02T00:00:00Z'),
  ]
  const table = { 1: row('resumable', true), 2: row('implement'), 3: row('merge', true), 4: row('grilling', true), 5: row('verify') }
  assert.deepEqual(lines(issues, table).map((r) => r.number), [1, 4, 3, 2, 5])
})

test('PRs: one that closes no Issue gets its own row; one that closes an Issue does not', () => {
  const out = lines([], {}, [pr(8, 'A plain description'), pr(9, 'Closes #3')])
  assert.deepEqual(out.map((r) => [r.kind, r.number, r.stage, r.gate]), [['pr', 8, 'unlinked-pr', true]])
})

test('limit: only the most recently updated Issues are checked, and a last line counts the rest', () => {
  const issues = [issue(1, '2026-10-01T00:00:00Z'), issue(2, '2026-10-03T00:00:00Z'), issue(3, '2026-10-02T00:00:00Z')]
  const out = lines(issues, { 2: row('implement'), 3: row('implement') }, [], 2)
  assert.deepEqual(out.map((r) => r.number ?? r), [3, 2, { more: 1 }])
  assert.equal(lines(issues, { 1: row('implement'), 2: row('implement'), 3: row('implement') }, [], 3).some((r) => 'more' in r), false)
})

test('errors: one Issue failing does not hide the others', () => {
  const issues = [issue(1, '2026-10-01T00:00:00Z'), issue(2, '2026-10-02T00:00:00Z')]
  const out = lines(issues, { 1: new Error('boom'), 2: row('implement') })
  assert.deepEqual(out.map((r) => [r.number, r.stage, r.why]), [[1, 'error', 'boom'], [2, 'implement', 'implement']])
})

// A stand-in for `gh`, as in stage.test.mjs: answers each call from a table, logs every call,
// and fails on a call the table does not have.
const STUB = `#!/usr/bin/env node
const fs = require('fs')
const key = process.argv.slice(2).join(' ')
fs.appendFileSync(process.env.GH_LOG, key + '\\n')
const r = JSON.parse(fs.readFileSync(process.env.GH_STUB, 'utf8'))[key]
if (!r) { process.stderr.write('stub: unexpected call: gh ' + key + '\\n'); process.exit(99) }
if (r.stdout !== undefined) process.stdout.write(typeof r.stdout === 'string' ? r.stdout : JSON.stringify(r.stdout))
if (r.stderr) process.stderr.write(r.stderr)
process.exit(r.code ?? 0)
`

function runStatus(responses) {
  const tmp = mkdtempSync(join(tmpdir(), 'status-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  writeFileSync(join(tmp, 'stub.json'), JSON.stringify(responses))
  const cwd = join(tmp, 'checkout')
  mkdirSync(cwd)
  const git = (...args) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, GH_STUB: join(tmp, 'stub.json'), GH_LOG: join(tmp, 'calls.log') }
  writeFileSync(env.GH_LOG, '')
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env, encoding: 'utf8' })
  return { ...r, calls: readFileSync(env.GH_LOG, 'utf8').split('\n').filter(Boolean), out: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

const ISSUES = 'api --paginate --slurp repos/{owner}/{repo}/issues?state=open&per_page=100'
const PULLS = 'api --paginate --slurp repos/{owner}/{repo}/pulls?state=all&per_page=100'
const USER = 'api user'
const REPO = 'api repos/{owner}/{repo}'
const CONFIG = 'api repos/{owner}/{repo}/contents/.github/macro-loop.json'
const COMMENTS = (n) => `api --paginate --slurp repos/{owner}/{repo}/issues/${n}/comments`
const config = (text) => ({ stdout: { content: Buffer.from(text).toString('base64'), encoding: 'base64' } })
const shared = (over = {}) => ({
  [USER]: { stdout: { login: 'carol' } },
  [REPO]: { stdout: { owner: { login: 'carol', type: 'User' }, default_branch: 'main' } },
  [CONFIG]: config('{"trusted":[]}'),
  [PULLS]: { stdout: [[]] },
  ...over,
})

test('run: pull requests in the Issues list are skipped, an unlinked PR is listed, and no write call is made', () => {
  const r = runStatus(shared({
    [ISSUES]: { stdout: [[{ number: 8, title: 'a PR', pull_request: {}, updated_at: '2026-10-01T00:00:00Z' }]] },
    [PULLS]: { stdout: [[{ ...pr(8, 'no link'), state: 'open' }]] },
  }))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out.map((o) => [o.kind, o.number, o.stage]), [['pr', 8, 'unlinked-pr']])
  assert.equal(r.calls.some((call) => /(^| )-X /.test(call)), false)
})

const labelled = (number, updated, ...names) => ({ ...issue(number, updated), state: 'open', labels: names.map((name) => ({ name })) })
const SPEC = { id: 1, user: { login: 'carol' }, body: '<!-- macro-loop:spec -->' }
const PASS = { id: 2, user: { login: 'carol' }, body: '<!-- macro-loop:verify round=1 sha=abc1234 -->\n## Verify: PASS (round 1 of 3)' }
const threeIssues = (over = {}) => shared({
  [ISSUES]: { stdout: [[
    labelled(1, '2026-10-03T00:00:00Z', 'P1', 'ready-for-agent'),
    labelled(2, '2026-10-02T00:00:00Z', 'P1', 'needs-decision'),
    labelled(3, '2026-10-01T00:00:00Z', 'P1', 'ready-for-agent'),
  ]] },
  [PULLS]: { stdout: [[
    { ...pr(5, 'Closes #3'), state: 'open', merged_at: null, user: { login: 'carol' }, head: { sha: 'abc1234' }, base: { ref: 'main' } },
    { ...pr(6, 'no link'), state: 'closed', merged_at: '2026-09-01T00:00:00Z' },
    { ...pr(8, 'no link'), state: 'open', merged_at: null },
  ]] },
  [COMMENTS(1)]: { stdout: [[SPEC]] },
  [COMMENTS(2)]: { stdout: [[]] },
  [COMMENTS(3)]: { stdout: [[SPEC]] },
  [COMMENTS(5)]: { stdout: [[PASS]] },
  ...over,
})

test('run: what every Issue shares is read once, and each Issue costs only its comments and its PR\'s', () => {
  const r = runStatus(threeIssues())
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out.map((o) => [o.kind, o.number, o.stage]), [
    ['issue', 3, 'merge'],
    ['pr', 8, 'unlinked-pr'],
    ['issue', 2, 'grilling'],
    ['issue', 1, 'implement'],
  ])
  for (const call of [ISSUES, USER, REPO, CONFIG, PULLS, COMMENTS(1), COMMENTS(2), COMMENTS(3), COMMENTS(5)]) {
    assert.equal(r.calls.filter((c) => c === call).length, 1, call)
  }
  assert.equal(r.calls.length, 9, r.calls.join('\n'))
})

test('run: when what every Issue shares cannot be read, nothing is printed and the run fails', () => {
  const r = runStatus(threeIssues({ [CONFIG]: config('{ not json') }))
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /status\.mjs: .*not valid JSON/)
})

test('run: an Issue whose comments cannot be read is an error row, and the others are printed', () => {
  const r = runStatus(threeIssues({ [COMMENTS(2)]: { stderr: 'gh: Server Error (HTTP 500)\n', code: 1 } }))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out.map((o) => [o.number, o.stage]), [[3, 'merge'], [8, 'unlinked-pr'], [2, 'error'], [1, 'implement']])
})

test('run: a failing gh call prints nothing on stdout, the error on stderr, and exits non-zero', () => {
  const r = runStatus({ [ISSUES]: { stderr: 'gh: Not Found (HTTP 404)\n', code: 1 } })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /status\.mjs: .*404/)
})
