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
const stages = (table) => (n) => {
  const r = table[n]
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
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, GH_STUB: join(tmp, 'stub.json'), GH_LOG: join(tmp, 'calls.log') }
  writeFileSync(env.GH_LOG, '')
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env, encoding: 'utf8' })
  return { ...r, calls: readFileSync(env.GH_LOG, 'utf8').split('\n').filter(Boolean), out: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

const ISSUES = 'api --paginate --slurp repos/{owner}/{repo}/issues?state=open&per_page=100'
const PULLS = 'api --paginate --slurp repos/{owner}/{repo}/pulls?state=open&per_page=100'

test('run: pull requests in the Issues list are skipped, an unlinked PR is listed, and no write call is made', () => {
  const r = runStatus({
    [ISSUES]: { stdout: [[{ number: 8, title: 'a PR', pull_request: {}, updated_at: '2026-10-01T00:00:00Z' }]] },
    [PULLS]: { stdout: [[pr(8, 'no link')]] },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out.map((o) => [o.kind, o.number, o.stage]), [['pr', 8, 'unlinked-pr']])
  assert.equal(r.calls.some((call) => /(^| )-X /.test(call)), false)
})

test('run: a failing gh call prints nothing on stdout, the error on stderr, and exits non-zero', () => {
  const r = runStatus({ [ISSUES]: { stderr: 'gh: Not Found (HTTP 404)\n', code: 1 } })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /status\.mjs: .*404/)
})
