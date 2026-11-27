import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/macro-loop/scripts/stage.mjs')
const { stageOf, noteState, findPr, trackingOf } = await import(pathToFileURL(SCRIPT).href)

test('findPr: a PR is found for every Issue it closes', () => {
  const p = { body: 'Closes #1\nCloses #2', state: 'open' }
  assert.equal(findPr(1, [p]), p)
  assert.equal(findPr(2, [p]), p)
  assert.equal(findPr(3, [p]), null)
})

const signals = (over = {}) => ({
  closed: false,
  states: [],
  priority: true,
  spec: false,
  branchAhead: false,
  pr: null,
  note: { addressedTo: null, resumable: false },
  ...over,
})
const pr = (over = {}) => ({ state: 'open', head: 'h2', verdicts: 0, result: null, sha: null, ...over })
const pick = (over) => {
  const { stage, gate } = stageOf(signals(over))
  return [stage, gate]
}

test('rows: each row of the table gives its stage and gate', () => {
  const rows = [
    [{ closed: true }, ['done', false]],
    [{ states: ['wontfix'] }, ['done', false]],
    [{ states: ['ready', 'needsInfo'] }, ['stop', true]],
    [{ pr: pr({ state: 'merged' }) }, ['done', false]],
    [{ pr: pr({ verdicts: 3, result: 'NEEDS-FIX', sha: 'h2' }) }, ['stop', true]],
    [{ pr: pr({ verdicts: 1, result: 'PASS', sha: 'h2' }) }, ['merge', true]],
    [{ pr: pr({ verdicts: 1, result: 'NEEDS-FIX', sha: 'h2' }) }, ['implement', false]],
    [{ pr: pr() }, ['verify', false]],
    [{ branchAhead: true }, ['open-pr', false]],
    [{ states: ['needsInfo'], note: { addressedTo: 'requester', resumable: true } }, ['resumable', true]],
    [{ states: ['needsDecision'] }, ['grilling', true]],
    [{ states: ['needsInfo'], note: { addressedTo: 'user', resumable: false } }, ['grilling', true]],
    [{ states: ['needsInfo'], note: { addressedTo: 'requester', resumable: false } }, ['wait', true]],
    [{ priority: false }, ['triage', false]],
    [{ states: ['ready'] }, ['grilling', true]],
    [{ states: ['ready'], spec: true }, ['implement', false]],
    [{}, ['stop', true]],
  ]
  for (const [over, expected] of rows) assert.deepEqual(pick(over), expected, JSON.stringify(over))
})

test('proxy: a needs-info note for the user gives wait; needs-decision and a non-proxy Issue stay grilling', () => {
  const toUser = { addressedTo: 'user', resumable: false }
  assert.deepEqual(pick({ states: ['needsInfo'], note: toUser, proxy: true }), ['wait', true])
  assert.deepEqual(pick({ states: ['needsInfo'], note: toUser, proxy: false }), ['grilling', true])
  assert.deepEqual(pick({ states: ['needsDecision'], note: toUser, proxy: true }), ['grilling', true])
})

test('precedence: the first matching row wins', () => {
  assert.equal(stageOf(signals({ states: ['ready', 'needsDecision'], pr: pr({ state: 'merged' }) })).stage, 'stop')
  assert.equal(stageOf(signals({ closed: true, pr: pr() })).stage, 'done')
  assert.equal(stageOf(signals({ pr: pr({ state: 'merged' }), branchAhead: true, states: ['needsInfo'] })).stage, 'done')
  assert.equal(stageOf(signals({ pr: pr(), branchAhead: true })).stage, 'verify')
  assert.equal(stageOf(signals({ branchAhead: true, states: ['needsDecision'], priority: false })).stage, 'open-pr')
})

test('verdicts: the cap holds after a push; a verdict for an older head sends the PR to verify', () => {
  assert.equal(stageOf(signals({ pr: pr({ verdicts: 3, result: 'NEEDS-FIX', sha: 'old' }) })).stage, 'stop')
  assert.equal(stageOf(signals({ pr: pr({ verdicts: 2, result: 'NEEDS-FIX', sha: 'h2' }) })).stage, 'implement')
  assert.equal(stageOf(signals({ pr: pr({ verdicts: 2, result: 'NEEDS-FIX', sha: 'old' }) })).stage, 'verify')
  assert.equal(stageOf(signals({ pr: pr({ verdicts: 1, result: 'PASS', sha: 'old' }) })).stage, 'verify')
})

test('conflict: implement ahead of every verdict row but the cap; no conflict keeps today\'s stage (#318)', () => {
  const at = (over) => stageOf(signals({ pr: pr({ base: 'main', ...over }) }))
  for (const v of [{}, { verdicts: 1, result: 'PASS', sha: 'h2' }, { verdicts: 1, result: 'NEEDS-FIX', sha: 'h2' }, { verdicts: 1, result: 'PASS', sha: 'old' }]) {
    assert.equal(at({ ...v, conflict: true }).stage, 'implement', JSON.stringify(v))
    assert.match(at({ ...v, conflict: true }).why, /^conflicts with main: bring the branch up to date/)
    assert.deepEqual(at({ ...v, conflict: false }), at(v))
  }
  assert.equal(at({ verdicts: 3, result: 'NEEDS-FIX', sha: 'h2', conflict: true }).stage, 'stop')
})

test('verdicts: a verdict with no SHA counts as judging the current head', () => {
  assert.equal(stageOf(signals({ pr: pr({ verdicts: 1, result: 'PASS', sha: null }) })).stage, 'merge')
})

test('no row fits: stop, and why names the signals', () => {
  const r = stageOf(signals({ spec: false, priority: true }))
  assert.equal(r.stage, 'stop')
  assert.match(r.why, /priority=true spec=false branch=false pr=none/)
})

const NOTE = '> *This was generated by AI during triage.*\n\n**What we still need from you (@carol):**\n- q'
const c = (login, body) => ({ user: { login }, body })

test('note: resumable only for a trusted, non-AI comment after the newest note', () => {
  const trusted = ['carol']
  assert.equal(noteState([c('carol', NOTE), c('carol', 'It is (b)')], trusted).resumable, true)
  assert.equal(noteState([c('carol', NOTE)], trusted).resumable, false)
  assert.equal(noteState([c('carol', 'It is (b)'), c('carol', NOTE)], trusted).resumable, false)
  assert.equal(noteState([c('carol', NOTE), c('mallory', 'It is (b)')], trusted).resumable, false)
  assert.equal(noteState([c('carol', NOTE), c('carol', '> *This was generated by AI during triage.*\nmore')], trusted).resumable, false)
  assert.equal(noteState([c('carol', NOTE), c('carol', '<!-- macro-loop:verify round=1 -->\nPASS')], trusted).resumable, false)
  assert.equal(noteState([c('mallory', NOTE)], trusted).resumable, false)
})

test('note: addressed to a trusted login is the user; anyone else is the requester', () => {
  assert.equal(noteState([c('carol', NOTE)], ['carol']).addressedTo, 'user')
  assert.equal(noteState([c('dave', NOTE)], ['dave']).addressedTo, 'requester')
  assert.equal(noteState([], ['carol']).addressedTo, null)
})

test('tracking: a tracking Issue is goal, merge when every child is ticked, and done when closed', () => {
  const tracking = (done, total) => ({ tracking: { done, total }, priority: false })
  assert.deepEqual(pick(tracking(1, 3)), ['goal', true])
  assert.deepEqual(pick(tracking(3, 3)), ['merge', true])
  assert.equal(pick({ ...tracking(1, 3), closed: true })[0], 'done')
})

test('trackingOf: the marker and a trusted author make a tracking Issue; the ticks are counted', () => {
  const body = '<!-- macro-loop:goal -->\n## Goal\n- [x] #1\n- [ ] #2\n* [X] #3\n- [ ] not an issue'
  assert.deepEqual(trackingOf({ body, user: { login: 'Carol' } }, ['carol']), { done: 2, total: 3 })
  assert.equal(trackingOf({ body, user: { login: 'mallory' } }, ['carol']), null)
  assert.equal(trackingOf({ body: `x\n${body}`, user: { login: 'carol' } }, ['carol']), null)
  assert.equal(trackingOf({ body: '<!-- macro-loop:goal -->\nno list', user: { login: 'carol' } }, ['carol']), null)
})

test('trackingOf: items under After the children are no children and never block the merge (#308)', () => {
  const body = '<!-- macro-loop:goal -->\n- [x] #1\n- [x] #2\n\n## After the children\n- [ ] Judge the earlier runs\n- [ ] Record the outcomes on #9'
  const tracking = trackingOf({ body, user: { login: 'carol' } }, ['carol'])
  assert.deepEqual(tracking, { done: 2, total: 2 })
  assert.deepEqual(pick({ tracking, priority: false }), ['merge', true])
})

// A stand-in for `gh`, as in trust.test.mjs: answers each call from a table keyed by its
// arguments, logs every call, and fails on a call the table does not have.
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

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })

// A checkout with origin/main, and, with `branch`, a branch ahead of it.
function runStage(responses, { branch } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'stage-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  writeFileSync(join(tmp, 'stub.json'), JSON.stringify(responses))
  const cwd = join(tmp, 'checkout')
  mkdirSync(cwd)
  git(cwd, 'init', '-q')
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'base')
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  if (branch) {
    git(cwd, 'switch', '-q', '-c', branch)
    git(cwd, 'commit', '-q', '--allow-empty', '-m', 'work')
  }
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, GH_STUB: join(tmp, 'stub.json'), GH_LOG: join(tmp, 'calls.log') }
  writeFileSync(env.GH_LOG, '')
  const r = spawnSync(process.execPath, [SCRIPT, '--issue', '77'], { cwd, env, encoding: 'utf8' })
  return { ...r, calls: readFileSync(env.GH_LOG, 'utf8').split('\n').filter(Boolean), out: r.status === 0 ? JSON.parse(r.stdout) : null }
}

const repo = { stdout: { owner: { login: 'JuHyeonni', type: 'User' }, default_branch: 'main' } }
const contents = { stdout: { content: Buffer.from(JSON.stringify({ trusted: [] })).toString('base64'), encoding: 'base64' } }
const spec = { id: 1, user: { login: 'JuHyeonni' }, body: '<!-- macro-loop:spec -->' }
const ISSUE_COMMENTS = 'api --paginate --slurp repos/{owner}/{repo}/issues/77/comments'
const PULLS = 'api --paginate --slurp repos/{owner}/{repo}/pulls?state=all&per_page=100'
const COMPARE = 'api repos/{owner}/{repo}/compare/abc1234...main'
const FILES5 = 'api --paginate --slurp repos/{owner}/{repo}/pulls/5/files'
const base = (over = {}) => ({
  'api user': { stdout: { login: 'Carol' } },
  'api repos/{owner}/{repo}': repo,
  'api repos/{owner}/{repo}/contents/.github/macro-loop.json': contents,
  'api repos/{owner}/{repo}/issues/77': { stdout: { state: 'open', labels: [{ name: 'P1' }, { name: 'ready-for-agent' }] } },
  [ISSUE_COMMENTS]: { stdout: [[spec]] },
  [PULLS]: { stdout: [[]] },
  [COMPARE]: { stdout: { files: [{ filename: 'other.md' }] } },
  [FILES5]: { stdout: [[{ filename: 'stage.mjs' }]] },
  ...over,
})
test('run: an Issue with a spec and no branch or PR gives implement, and makes no write call', () => {
  const r = runStage(base())
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.out.stage, r.out.gate], ['implement', false])
  assert.equal(r.calls.some((call) => /(^| )-X /.test(call)), false)
  assert.equal(r.calls.filter((call) => call === ISSUE_COMMENTS).length, 1)
})

test('run: a trusted Issue with the marker and a task list gives goal with the ticks in why; an untrusted author gives a plain Issue', () => {
  const body = '<!-- macro-loop:goal -->\n- [x] #1\n- [ ] #2'
  const issue = (login) => ({ stdout: { state: 'open', labels: [], body, user: { login } } })
  const mine = runStage(base({ 'api repos/{owner}/{repo}/issues/77': issue('Carol') }))
  assert.equal(mine.status, 0, mine.stderr)
  assert.equal(mine.out.stage, 'goal')
  assert.match(mine.out.why, /1 of 2 children done/)
  const other = runStage(base({ 'api repos/{owner}/{repo}/issues/77': issue('mallory') }))
  assert.equal(other.out.stage, 'triage')
})

test('run: the proxy label comes from the config, so a renamed label gives wait and source:proxy does not', () => {
  const labels = (name) => ({ stdout: { state: 'open', labels: [{ name: 'P1' }, { name: 'needs-info' }, { name }] } })
  const note = { id: 3, user: { login: 'Carol' }, body: '> *This was generated by AI during triage.*\nWhat we still need from you (@Carol)' }
  const renamed = { stdout: { content: Buffer.from(JSON.stringify({ trusted: [], labels: { source: { proxy: 'via-proxy' } } })).toString('base64'), encoding: 'base64' } }
  const run = (config, label) => runStage(base({
    'api repos/{owner}/{repo}/contents/.github/macro-loop.json': config,
    'api repos/{owner}/{repo}/issues/77': labels(label),
    [ISSUE_COMMENTS]: { stdout: [[spec, note]] },
  }))
  assert.equal(run(renamed, 'via-proxy').out.stage, 'wait')
  assert.equal(run(renamed, 'source:proxy').out.stage, 'grilling')
  assert.equal(run(contents, 'source:proxy').out.stage, 'wait')
})

test('run: a local branch ahead of the default branch gives open-pr', () => {
  const r = runStage(base(), { branch: '77-stage-script' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.stage, 'open-pr')
})

const PULL5 = 'api repos/{owner}/{repo}/pulls/5'
// An open PR #5 on main whose verdict is PASS for its head, with `pulls/5` answering `pull`.
const passing = (pull) => runStage(base({
  [PULLS]: { stdout: [[{ number: 5, state: 'open', merged_at: null, body: 'Closes #77', user: { login: 'carol' }, head: { sha: 'abc1234' }, base: { ref: 'main' } }]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/5/comments': { stdout: [[{ id: 2, user: { login: 'carol' }, body: '<!-- macro-loop:verify round=1 sha=abc1234 -->\n## Verify: PASS (round 1 of 3)' }]] },
  [PULL5]: pull,
}))

test('run: an open PR with a PASS for its head gives merge, reading pulls/<n> once for mergeable', () => {
  const r = passing({ stdout: { number: 5, mergeable: true } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.out.stage, r.out.gate], ['merge', true])
  assert.equal(r.calls.filter((call) => call === PULL5).length, 1)
})

// PR #5's PASS for its head, plus `extra` PR comments, under a config with `security`.
const securing = (security, extra = []) => runStage(base({
  'api repos/{owner}/{repo}/contents/.github/macro-loop.json': { stdout: { content: Buffer.from(JSON.stringify({ trusted: [], ...(security ? { security } : {}) })).toString('base64'), encoding: 'base64' } },
  [PULLS]: { stdout: [[{ number: 5, state: 'open', merged_at: null, body: 'Closes #77', user: { login: 'carol' }, head: { sha: 'abc1234' }, base: { ref: 'main' } }]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/5/comments': { stdout: [[{ id: 2, user: { login: 'carol' }, body: '<!-- macro-loop:verify round=1 sha=abc1234 -->\n## Verify: PASS (round 1 of 3)' }, ...extra]] },
  [PULL5]: { stdout: { number: 5, mergeable: true } },
}))
const securityComment = (sha, login = 'carol') => ({ id: 3, user: { login }, body: `<!-- macro-loop:security sha=${sha} -->\n## Security review: no findings` })

test('#343 AC5: with security.waitBeforeMerge true, a PASS for the head waits for its security comment, then gives merge', () => {
  const waiting = securing({ waitBeforeMerge: true })
  assert.equal(waiting.status, 0, waiting.stderr)
  assert.deepEqual([waiting.out.stage, waiting.out.gate], ['wait', true])
  assert.equal(waiting.out.why, 'the security review for this head has not reported (round 1, head abc1234)')
  for (const extra of [[securityComment('0000000')], [securityComment('abc1234', 'mallory')]]) {
    assert.equal(securing({ waitBeforeMerge: true }, extra).out.stage, 'wait', JSON.stringify(extra))
  }
  const reported = securing({ waitBeforeMerge: true }, [securityComment('abc1234')])
  assert.deepEqual([reported.out.stage, reported.out.gate], ['merge', true])
})

test('#343 AC6: with security.waitBeforeMerge false or unset, a PASS for the head gives merge with no security comment (guards existing behavior)', () => {
  for (const security of [{ waitBeforeMerge: false }, null]) {
    const r = securing(security)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual([r.out.stage, r.out.gate], ['merge', true])
  }
})

test('run: an open PR that conflicts with its base gives implement naming the base, even with a PASS (#318)', () => {
  const r = passing({ stdout: { number: 5, mergeable: false } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.out.stage, r.out.gate], ['implement', false])
  assert.match(r.out.why, /^conflicts with main: bring the branch up to date \(round 1, head abc1234\)$/)
})

test('run: mergeable null, while GitHub computes it, counts as no conflict (#318)', () => {
  const r = passing({ stdout: { number: 5, mergeable: null } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.stage, 'merge')
})

// PR #5's PASS for its head, after `compare` answers what main changed since the PR's base.
const moved = (compare, pull = { stdout: { number: 5, mergeable: true } }) => runStage(base({
  [PULLS]: { stdout: [[{ number: 5, state: 'open', merged_at: null, body: 'Closes #77', user: { login: 'carol' }, head: { sha: 'abc1234' }, base: { ref: 'main' } }]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/5/comments': { stdout: [[{ id: 2, user: { login: 'carol' }, body: '<!-- macro-loop:verify round=1 sha=abc1234 -->\n## Verify: PASS (round 1 of 3)' }]] },
  [PULL5]: pull,
  [COMPARE]: compare,
  [FILES5]: { stdout: [[{ filename: 'a.mjs' }, { filename: 'b.md' }]] },
}))

test('#345 AC2: an open PR with a PASS whose files main changed since its base gives implement naming the change', () => {
  for (const file of [{ filename: 'b.md' }, { filename: 'c.md', previous_filename: 'a.mjs' }]) {
    const r = moved({ stdout: { files: [{ filename: 'x.md' }, file] } })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual([r.out.stage, r.out.gate], ['implement', false], JSON.stringify(file))
    assert.equal(r.out.why, 'main changed files this PR touches since its verdict: bring the branch up to date (round 1, head abc1234)')
    assert.equal(r.calls.filter((call) => call === COMPARE).length, 1)
  }
})

test('#345 AC3: the same PR keeps merge when main\'s new commits touch none of its files (guards existing behavior)', () => {
  for (const files of [[{ filename: 'x.md' }], [], undefined]) {
    const r = moved({ stdout: { files } })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual([r.out.stage, r.out.gate], ['merge', true], JSON.stringify(files))
  }
})

test('#345 AC4: a conflicting PR still gives the conflict reason, and three NEEDS-FIX verdicts still give stop (guards existing behavior)', () => {
  const touched = { stdout: { files: [{ filename: 'a.mjs' }] } }
  const r = moved(touched, { stdout: { number: 5, mergeable: false } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.out.why, /^conflicts with main: bring the branch up to date/)
  const capped = specEdit(3, '2025-12-31T00:00:00Z', { [COMPARE]: touched })
  assert.equal(capped.status, 0, capped.stderr)
  assert.deepEqual([capped.out.stage, capped.out.gate], ['stop', true])
  assert.deepEqual(stageOf(signals({ pr: pr({ verdicts: 3, result: 'NEEDS-FIX', sha: 'h2', baseChanged: true }) })).stage, 'stop')
})

test('#345 AC5: a failed compare read prints nothing and exits non-zero with the error', () => {
  const r = moved({ stderr: 'gh: Server Error (HTTP 502)\n', code: 1 })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /stage\.mjs: .*compare\/abc1234\.\.\.main.*502/)
})

test('run: a failed pulls/<n> read prints nothing and exits non-zero with the error (#318)', () => {
  const r = passing({ stderr: 'gh: Server Error (HTTP 502)\n', code: 1 })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /stage\.mjs: .*pulls\/5.*502/)
})

test('run: with two open PRs closing the Issue, why names the PR used and the other one', () => {
  const pr = (number, ref, branchBase = 'main') => ({ number, state: 'open', merged_at: null, body: 'Closes #77', user: { login: 'carol' }, head: { sha: 'abc1234', ref }, base: { ref: branchBase } })
  const r = runStage(base({
    [PULLS]: { stdout: [[pr(8, 'old'), pr(6, '77-fix'), pr(5, '77-test', 'seed')]] },
    'api --paginate --slurp repos/{owner}/{repo}/issues/6/comments': { stdout: [[]] },
    'api repos/{owner}/{repo}/pulls/6': { stdout: { number: 6, mergeable: true } },
    'api --paginate --slurp repos/{owner}/{repo}/pulls/6/files': { stdout: [[]] },
  }))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.out.why, /\(using PR #6; also closing: #8\)$/)
})

test('run: a failing gh call prints nothing on stdout, the error on stderr, and exits non-zero', () => {
  const r = runStage(base({ 'api repos/{owner}/{repo}/issues/77': { stderr: 'gh: Not Found (HTTP 404)\n', code: 1 } }))
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /stage\.mjs: .*404/)
})

test('NEEDS-FIX: implement below the cap, stop at it, and the line differs by round and head (#192, #193)', () => {
  const line = (over) => stageOf(signals({ pr: pr({ result: 'NEEDS-FIX', sha: 'h2', ...over }) }))
  assert.equal(line({ verdicts: 1 }).stage, 'implement')
  assert.equal(line({ verdicts: 2 }).stage, 'implement')
  assert.deepEqual([line({ verdicts: 3 }).stage, line({ verdicts: 3 }).gate], ['stop', true])
  assert.notDeepEqual(line({ verdicts: 1 }), line({ verdicts: 2 }))
  assert.notDeepEqual(line({ verdicts: 1, head: 'a1b2c3d4e5', sha: 'a1b2c3d4e5' }), line({ verdicts: 1, head: 'f6e5d4c3b2', sha: 'f6e5d4c3b2' }))
  assert.deepEqual(line({ verdicts: 1 }), line({ verdicts: 1 }))
})

test('a row names the round of the verdict it describes; verify names the round to come (#309)', () => {
  const line = (over) => stageOf(signals({ pr: pr({ sha: 'h2', ...over }) }))
  const pass = line({ verdicts: 1, result: 'PASS' })
  assert.equal(pass.stage, 'merge')
  assert.match(pass.why, /\(round 1, head h2\)$/)
  const fix = line({ verdicts: 1, result: 'NEEDS-FIX' })
  assert.equal(fix.stage, 'implement')
  assert.match(fix.why, /\(round 1, head h2\)$/)
  const none = line({ verdicts: 0, sha: null })
  assert.equal(none.stage, 'verify')
  assert.match(none.why, /\(next round 1, head h2\)$/)
  const stale = line({ verdicts: 1, result: 'PASS', sha: 'h1' })
  assert.equal(stale.stage, 'verify')
  assert.match(stale.why, /\(next round 2, head h2\)$/)
  const stop = line({ verdicts: 3, result: 'NEEDS-FIX' })
  assert.equal(stop.stage, 'stop')
  assert.match(stop.why, /\(round 3, head h2\)$/)
  assert.notDeepEqual(line({ verdicts: 1, result: 'PASS', sha: 'h1' }), line({ verdicts: 2, result: 'PASS', sha: 'h1' }))
  assert.notDeepEqual(line({ verdicts: 0, head: 'a1b2c3d4e5' }), line({ verdicts: 0, head: 'f6e5d4c3b2' }))
})

test('skills: goal and execute keep no NEEDS-FIX rule of their own; stage.mjs decides (#193)', () => {
  const text = (n) => readFileSync(join(ROOT, `plugins/macro-loop/skills/${n}/SKILL.md`), 'utf8')
  assert.doesNotMatch(text('execute'), /after a person has read the verdict|nothing was fixed automatically/i)
  assert.doesNotMatch(text('goal'), /third NEEDS-FIX|never fix a NEEDS-FIX/i)
  assert.match(text('goal'), /stage\.mjs/)
})

// A PR whose newest verdict is NEEDS-FIX for its head, after `rounds` verdicts, with the spec last updated at `specAt` (#316).
const specEdit = (rounds, specAt, extra = {}) => runStage(base({
  [ISSUE_COMMENTS]: { stdout: [[{ ...spec, updated_at: specAt }]] },
  [PULL5]: { stdout: { number: 5, mergeable: true } },
  [PULLS]: { stdout: [[{ number: 5, state: 'open', merged_at: null, body: 'Closes #77', user: { login: 'carol' }, head: { sha: 'abc1234' }, base: { ref: 'main' } }]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/5/comments': {
    stdout: [Array.from({ length: rounds }, (_, i) => ({
      id: 10 + i,
      user: { login: 'carol' },
      created_at: `2026-01-0${i + 1}T00:00:00Z`,
      body: `<!-- macro-loop:verify round=${i + 1} sha=abc1234 -->\n## Verify: NEEDS-FIX (round ${i + 1} of 3)`,
    }))],
  },
  ...extra,
}))

test('run: a spec updated after the NEEDS-FIX verdict for the head gives verify, naming the spec change (#316)', () => {
  const r = specEdit(1, '2026-01-02T00:00:00Z')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.out.stage, r.out.gate], ['verify', false])
  assert.match(r.out.why, /spec changed after the NEEDS-FIX verdict \(next round 2, head abc1234\)$/)
})

test('run: a spec last updated before the NEEDS-FIX verdict still gives implement (#316)', () => {
  const r = specEdit(1, '2025-12-31T00:00:00Z')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.stage, 'implement')
})

test('run: three NEEDS-FIX verdicts give stop even with a spec updated after the newest (#316)', () => {
  const r = specEdit(3, '2026-01-09T00:00:00Z')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.out.stage, r.out.gate], ['stop', true])
})
