import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/macro-loop/scripts/outcomes.mjs')
const { outcomes } = await import(pathToFileURL(SCRIPT).href)

const ME = 'carol'
const verdict = (result, sha = 'abc1234', login = ME) => ({
  user: { login },
  body: `<!-- macro-loop:verify round=1${sha ? ` sha=${sha}` : ''} -->\n## Verify: ${result} (round 1 of 3)`,
})
const pass = (sha) => verdict('PASS', sha)
const fix = (sha) => verdict('NEEDS-FIX', sha)
const pr = (number, over = {}) => ({
  number,
  body: `Closes #${number + 100}`,
  merged_at: '2026-10-10T00:00:00Z',
  closed_at: '2026-10-10T00:00:00Z',
  merge_commit_sha: `dddddd${number}`,
  head: { sha: 'abc1234', ref: `${number}-x` },
  base: { ref: 'main' },
  user: { login: ME },
  ...over,
})
const unmerged = (number, over = {}) => pr(number, { merged_at: null, merge_commit_sha: null, ...over })

function report({ prs, comments = {}, commits = [], prsOfCommit = {}, missed = [], ...rest }) {
  return outcomes({
    prs,
    repo: 'carol/app',
    trusted: [ME],
    commentsOf: (n) => comments[n] ?? [],
    commits: commits.map((message) => ({ commit: { message } })),
    prsOfCommit: (sha) => prsOfCommit[sha] ?? [],
    missedIssues: missed.map((number) => ({ number })),
    ...rest,
  })
}

test('AC1: round 1 means no NEEDS-FIX before the first PASS; round 3 means two or more; re-verifications after a PASS count on their own', () => {
  const r = report({
    prs: [pr(1), pr(2), pr(3), pr(4), pr(5)],
    comments: {
      1: [pass()],
      2: [fix(), pass()],
      3: [fix(), fix(), pass()],
      4: [fix(), fix()],
      5: [pass('bbbbbbb'), pass(), pass()],
    },
  })
  assert.deepEqual(r.rounds.passedRound1, { count: 2, of: 5 })
  assert.deepEqual(r.rounds.reachedRound3, { count: 2, of: 5 })
  assert.deepEqual(r.rounds.reverifiedAfterPass, { count: 1, of: 5 })
})

test('AC2: a verdict marker by an untrusted login, or not on the first line, is not counted', () => {
  const r = report({
    prs: [pr(1), pr(2)],
    comments: {
      1: [verdict('NEEDS-FIX', 'abc1234', 'mallory'), pass()],
      2: [{ user: { login: ME }, body: `quoting:\n${pass().body}` }],
    },
  })
  assert.deepEqual(r.rounds.passedRound1, { count: 1, of: 1 })
  assert.deepEqual(r.noVerdict, { count: 1, of: 2, noCloses: 0 })
})

test('AC3: a PR closed without merging counts in the rounds and "not merged", and in no merged-only metric', () => {
  const r = report({ prs: [pr(1), unmerged(2)], comments: { 1: [pass()], 2: [fix(), fix()] }, missed: [9] })
  assert.deepEqual(r.rounds.reachedRound3, { count: 1, of: 2 })
  assert.equal(r.rounds.notMerged, 1)
  assert.deepEqual(r.noVerdict, { count: 0, of: 1, noCloses: 0 })
  assert.deepEqual(r.mergedOnNeedsFix, { count: 0, of: 1 })
  assert.deepEqual(r.staleVerdict, { count: 0, of: 1 })
  assert.deepEqual(r.revertedPass, { count: 0, of: 1 })
})

test('AC4: merged PRs with no trusted verdict, out of all merged PRs, and how many of those close no Issue', () => {
  const r = report({ prs: [pr(1), pr(2), pr(3, { body: 'chore: bump' }), unmerged(4)], comments: { 1: [pass()] } })
  assert.deepEqual(r.noVerdict, { count: 2, of: 3, noCloses: 1 })
})

test('AC5: merged on NEEDS-FIX and merged on a verdict for another SHA are counted; a verdict without a SHA cannot tell', () => {
  const r = report({
    prs: [pr(1), pr(2), pr(3), pr(4)],
    comments: { 1: [pass()], 2: [fix()], 3: [pass('bbbbbbb')], 4: [pass(null)] },
  })
  assert.deepEqual(r.mergedOnNeedsFix, { count: 1, of: 4 })
  assert.deepEqual(r.staleVerdict, { count: 1, of: 3 })
  assert.deepEqual(r.cannotTell.verdictSha, [4])
})

test('AC6: a PASS PR is reverted by a commit naming one of its SHAs or by a merged PR body; an unknown SHA cannot tell', () => {
  const r = report({
    prs: [pr(1), pr(2), pr(3), pr(4), pr(5), pr(6, { body: 'Reverts carol/app#3\n\nReverts other/app#4' })],
    comments: { 1: [pass()], 2: [pass()], 3: [pass()], 4: [pass()], 5: [fix()] },
    commits: ['Revert "x"\n\nThis reverts commit dddddd1.', 'Revert "y"\n\nThis reverts commit abc1234def.', 'Revert "z"\n\nThis reverts commit fff9999.', 'This reverts commit dddddd5.'],
    prsOfCommit: { abc1234def: [2] },
  })
  assert.deepEqual(r.revertedPass, { count: 3, of: 4 })
  assert.deepEqual(r.cannotTell.revertSha, ['fff9999'])
})

test('AC7: a missed-label Issue with a trusted marker counts against a PASS merge, else as an unverified bug; without one it cannot tell', () => {
  const marker = (n, login = ME) => ({ user: { login }, body: `<!-- macro-loop:missed pr=${n} -->\nPASS missed this.` })
  const r = report({
    prs: [pr(1), pr(2), pr(3)],
    comments: { 1: [pass()], 2: [fix()], 50: [marker(1)], 51: [marker(2)], 52: [marker(3)], 53: [marker(1, 'mallory')], 54: [] },
    missed: [50, 51, 52, 53, 54],
  })
  assert.deepEqual(r.missedPass, { count: 1, of: 1 })
  assert.equal(r.missedUnverified, 2)
  assert.deepEqual(r.cannotTell.missedMarker, [53, 54])
})

test('AC8: --since and --until keep PRs merged, or closed when unmerged, inside the dates; reverts and missed bugs follow their PR', () => {
  const r = report({
    prs: [
      pr(1, { merged_at: '2026-09-30T23:00:00Z', closed_at: '2026-10-02T00:00:00Z' }),
      pr(2, { merged_at: '2026-10-01T00:00:00Z' }),
      pr(3, { merged_at: '2026-10-31T23:59:00Z' }),
      pr(4, { merged_at: '2026-11-01T00:00:00Z' }),
      unmerged(5, { closed_at: '2026-10-15T00:00:00Z' }),
      unmerged(6, { closed_at: '2026-11-15T00:00:00Z' }),
    ],
    comments: { 1: [pass()], 2: [pass()], 3: [pass()], 4: [pass()], 5: [pass()], 6: [pass()], 50: [{ user: { login: ME }, body: '<!-- macro-loop:missed pr=1 -->' }] },
    commits: ['This reverts commit dddddd4.'],
    missed: [50],
    since: '2026-10-01',
    until: '2026-10-31',
  })
  assert.equal(r.read, 3)
  assert.deepEqual(r.rounds.passedRound1, { count: 3, of: 3 })
  assert.deepEqual(r.revertedPass, { count: 0, of: 2 })
  assert.deepEqual(r.missedPass, { count: 0, of: 2 })
})

test('AC9: with more PRs than the limit, the most recent are read and the rest counted as more; comments are read only for those', () => {
  const read = []
  const prs = [1, 2, 3].map((n) => pr(n, { merged_at: `2026-10-0${n}T00:00:00Z` }))
  const r = outcomes({ prs, repo: 'carol/app', trusted: [ME], limit: 2, commentsOf: (n) => (read.push(n), []), commits: [], prsOfCommit: () => [], missedIssues: [] })
  assert.equal(r.more, 1)
  assert.deepEqual(read, [3, 2])
  assert.equal('more' in report({ prs }), false)
})

// A stand-in for `gh`, as in status.test.mjs.
const STUB = `#!/usr/bin/env node
const fs = require('fs')
const key = process.argv.slice(2).join(' ')
const r = JSON.parse(fs.readFileSync(process.env.GH_STUB, 'utf8'))[key]
if (!r) { process.stderr.write('stub: unexpected call: gh ' + key + '\\n'); process.exit(99) }
if (r.stdout !== undefined) process.stdout.write(JSON.stringify(r.stdout))
if (r.stderr) process.stderr.write(r.stderr)
process.exit(r.code ?? 0)
`

function run(responses, ...args) {
  const tmp = mkdtempSync(join(tmpdir(), 'outcomes-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  writeFileSync(join(tmp, 'stub.json'), JSON.stringify(responses))
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}`, GH_STUB: join(tmp, 'stub.json') }
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: tmp, env, encoding: 'utf8' })
}

const CONFIG = 'api repos/{owner}/{repo}/contents/.github/macro-loop.json'
const RESPONSES = {
  'api user': { stdout: { login: ME } },
  'api repos/{owner}/{repo}': { stdout: { owner: { login: ME, type: 'User' }, default_branch: 'main', full_name: 'carol/app' } },
  [CONFIG]: { stderr: 'gh: Not Found (HTTP 404)\n', code: 1 },
  'api --paginate --slurp repos/{owner}/{repo}/commits?sha=main&per_page=100': { stdout: [[{ commit: { message: 'This reverts commit 1234567.' } }]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues?state=all&labels=missed-by-verify&per_page=100': { stdout: [[]] },
  'api --paginate --slurp repos/{owner}/{repo}/pulls?state=closed&per_page=100': { stdout: [[pr(1)]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/1/comments': { stdout: [[pass()]] },
  'api repos/{owner}/{repo}/commits/1234567/pulls': { stderr: 'gh: No commit found for SHA: 1234567 (HTTP 422)\n', code: 1 },
}

test('run: one JSON line from GitHub reads; a SHA GitHub does not know cannot tell', () => {
  const r = run(RESPONSES)
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines.length, 1)
  const out = JSON.parse(lines[0])
  assert.deepEqual(out.rounds.passedRound1, { count: 1, of: 1 })
  assert.deepEqual(out.cannotTell.revertSha, ['1234567'])
})

test('AC9: a failing gh call prints nothing and exits non-zero', () => {
  const r = run({ ...RESPONSES, 'api --paginate --slurp repos/{owner}/{repo}/issues/1/comments': { stderr: 'gh: Server Error (HTTP 500)\n', code: 1 } })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /outcomes\.mjs: .*500/)
})

test('a malformed date is refused', () => {
  const r = run(RESPONSES, '--since', '10/01/2026')
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
})
