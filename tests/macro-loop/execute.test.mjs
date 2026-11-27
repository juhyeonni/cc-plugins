import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { candidates, specCommands, uiState, report } = await import(pathToFileURL(join(ROOT, 'plugins/macro-loop/scripts/execute.mjs')).href)

const row = (number, stage, over = {}) => ({ number, stage, why: `why ${number}`, prAuthor: null, ...over })
const TRUSTED = ['juhyeonni']

test('AC1: keeps exactly implement, open-pr and verify rows, each with its start stage', () => {
  const rows = [
    row(1, 'implement'),
    row(2, 'grilling'),
    row(3, 'open-pr'),
    row(4, 'verify', { prAuthor: 'JuhyeonNi' }),
    row(5, 'merge'),
    row(6, 'triage'),
    row(7, 'wait'),
    row(8, 'resumable'),
    row(9, 'stop'),
  ]
  const { run, left } = candidates(rows, { trusted: TRUSTED })
  assert.deepEqual(run.map((r) => [r.number, r.start]), [[1, 'implement'], [3, 'open-pr'], [4, 'verify']])
  assert.deepEqual(left, [])
})

test('AC1: an Issue whose open PR author is not trusted is left out and sent to verify', () => {
  const { run, left } = candidates([row(4, 'verify', { prAuthor: 'someone' }), row(5, 'implement', { prAuthor: 'someone' })], { trusted: TRUSTED })
  assert.deepEqual(run, [])
  assert.deepEqual(left.map((l) => [l.number, l.reason]), [
    [4, 'the PR author is not trusted: verify it with /macro-loop:verify'],
    [5, 'the PR author is not trusted: verify it with /macro-loop:verify'],
  ])
})

test('AC8: a tracking Issue is left out with its stage as the reason', () => {
  const { run, left } = candidates([row(10, 'goal', { why: '1 of 3 children done' })], { trusted: TRUSTED, given: [10] })
  assert.deepEqual(run, [])
  assert.deepEqual(left, [{ number: 10, stage: 'goal', reason: 'stage goal needs a person: 1 of 3 children done' }])
})

test('AC2: given numbers keep their order, and a given non-candidate is reported, not run', () => {
  const rows = [row(1, 'implement'), row(2, 'grilling'), row(3, 'verify', { prAuthor: 'juhyeonni' })]
  const { run, left } = candidates(rows, { trusted: TRUSTED, given: [3, 2, 1, 99] })
  assert.deepEqual(run.map((r) => r.number), [3, 1])
  assert.deepEqual(left, [
    { number: 2, stage: 'grilling', reason: 'stage grilling needs a person: why 2' },
    { number: 99, stage: null, reason: 'not an open Issue that status checked' },
  ])
})

test('specCommands: lists the check: cmd commands of a spec, in order', () => {
  const body = [
    '- [ ] AC1. a · check: test',
    '- [ ] AC2. b · check: cmd `ls plugins/x/SKILL.md`',
    '- [ ] AC3. c · check: cmd `grep -c "a b" README.md`',
    '- [ ] AC4. d · check: manual',
  ].join('\n')
  assert.deepEqual(specCommands(body), ['ls plugins/x/SKILL.md', 'grep -c "a b" README.md'])
  assert.deepEqual(specCommands(''), [])
})

test('#115 AC1: a spec body is a UI Issue with no placement, a placed one, or not a UI Issue', () => {
  assert.equal(uiState('**Goal:** x\nUI: yes\n\n**Decisions**\n'), 'missing')
  assert.equal(uiState('**Goal:** x\nUI: yes\nPlacement: option b (https://claude.ai/artifact/x)\n'), 'placed')
  assert.equal(uiState('**Goal:** x\n\n**Decisions**\n'), 'none')
  assert.equal(uiState('**Goal:** x\nPlacement: option b\n'), 'none')
  assert.equal(uiState('- D4. The spec holds `UI: yes` and a `Placement:` line.\n'), 'none')
  assert.equal(uiState(undefined), 'none')
})

test('#115 AC2: a UI Issue with no placement is left out with its reason; a placed or non-UI Issue runs', () => {
  const rows = [
    row(1, 'implement', { ui: 'missing' }),
    row(2, 'implement', { ui: 'placed' }),
    row(3, 'implement', { ui: 'none' }),
    row(4, 'implement'),
    row(5, 'open-pr', { ui: 'missing' }),
  ]
  const { run, left } = candidates(rows, { trusted: TRUSTED })
  assert.deepEqual(run.map((r) => r.number), [2, 3, 4, 5])
  assert.equal(left.length, 1)
  assert.equal(left[0].number, 1)
  assert.equal(left[0].stage, 'implement')
  assert.match(left[0].reason, /Placement:/)
  assert.match(left[0].reason, /\/macro-loop:ui-placement/)
})

test('#307 AC1: an Issue with an open blocker is left out naming each one, whatever its stage; one whose blockers are all closed runs', () => {
  const open = (number) => ({ number, state: 'open' })
  const closed = (number) => ({ number, state: 'closed' })
  const rows = [
    row(1, 'implement', { blockers: [open(5), closed(6), open(7)] }),
    row(2, 'implement', { blockers: [closed(5)] }),
    row(3, 'verify', { prAuthor: 'juhyeonni', blockers: [open(5)] }),
    row(4, 'grilling', { blockers: [open(5)] }),
  ]
  const { run, left } = candidates(rows, { trusted: TRUSTED, given: [1, 2, 3, 4] })
  assert.deepEqual(run.map((r) => [r.number, r.start]), [[2, 'implement']])
  assert.deepEqual(left, [
    { number: 1, stage: 'implement', reason: 'waits for #5, #7 to merge' },
    { number: 3, stage: 'verify', reason: 'waits for #5 to merge' },
    { number: 4, stage: 'grilling', reason: 'waits for #5 to merge' },
  ])
})

test('#307 AC2: an Issue with no blockers runs exactly as before', () => {
  const rows = [row(1, 'implement', { blockers: [] }), row(2, 'open-pr')]
  const { run, left } = candidates(rows, { trusted: TRUSTED })
  assert.deepEqual(run, [{ ...rows[0], start: 'implement' }, { ...rows[1], start: 'open-pr' }])
  assert.deepEqual(left, [])
})

// A stand-in for `gh`, as in stage.test.mjs: answers each call from a table keyed by its arguments.
const STUB = `#!/usr/bin/env node
const fs = require('fs')
const key = process.argv.slice(2).join(' ')
fs.appendFileSync(process.env.GH_LOG, key + '\\n')
const r = JSON.parse(fs.readFileSync(process.env.GH_STUB, 'utf8'))[key]
if (!r) { process.stderr.write('stub: unexpected call: gh ' + key + '\\n'); process.exit(99) }
if (r.stdout !== undefined) process.stdout.write(JSON.stringify(r.stdout))
if (r.stderr) process.stderr.write(r.stderr)
process.exit(r.code ?? 0)
`
const BLOCKED_BY = 'api --paginate --slurp repos/{owner}/{repo}/issues/77/dependencies/blocked_by?per_page=100'

function runExecute(blockedBy) {
  const tmp = mkdtempSync(join(tmpdir(), 'execute-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  const spec = { id: 1, user: { login: 'carol' }, body: '<!-- macro-loop:spec -->' }
  writeFileSync(join(tmp, 'stub.json'), JSON.stringify({
    'api user': { stdout: { login: 'carol' } },
    'api repos/{owner}/{repo}': { stdout: { owner: { login: 'carol', type: 'User' }, default_branch: 'main' } },
    'api repos/{owner}/{repo}/contents/.github/macro-loop.json': { stderr: 'gh: Not Found (HTTP 404)', code: 1 },
    'api --paginate --slurp repos/{owner}/{repo}/pulls?state=all&per_page=100': { stdout: [[]] },
    'api --paginate --slurp repos/{owner}/{repo}/issues?state=open&per_page=100': { stdout: [[{ number: 77, state: 'open', labels: [{ name: 'P1' }, { name: 'ready-for-agent' }], body: '', user: { login: 'carol' } }]] },
    'api --paginate --slurp repos/{owner}/{repo}/issues/77/comments': { stdout: [[spec]] },
    'api repos/{owner}/{repo}/issues/comments/1': { stdout: spec },
    [BLOCKED_BY]: blockedBy,
  }))
  const cwd = join(tmp, 'checkout')
  mkdirSync(cwd)
  spawnSync('git', ['init', '-q', cwd])
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, GH_STUB: join(tmp, 'stub.json'), GH_LOG: join(tmp, 'calls.log') }
  writeFileSync(env.GH_LOG, '')
  const r = spawnSync(process.execPath, [join(ROOT, 'plugins/macro-loop/scripts/execute.mjs')], { cwd, env, encoding: 'utf8' })
  return { ...r, calls: readFileSync(env.GH_LOG, 'utf8').split('\n').filter(Boolean), out: r.status === 0 ? JSON.parse(r.stdout) : null }
}

test("#307 AC3: execute.mjs reads each Issue's blockers from dependencies/blocked_by", () => {
  const waiting = runExecute({ stdout: [[{ number: 76, state: 'open' }]] })
  assert.equal(waiting.status, 0, waiting.stderr)
  assert.ok(waiting.calls.includes(BLOCKED_BY))
  assert.deepEqual(waiting.out.run, [])
  assert.deepEqual(waiting.out.left, [{ number: 77, stage: 'implement', reason: 'waits for #76 to merge' }])
  const free = runExecute({ stdout: [[{ number: 76, state: 'closed' }]] })
  assert.equal(free.status, 0, free.stderr)
  assert.deepEqual(free.out.run.map((r) => r.number), [77])
})

test('#307 AC3: a failed blocker read prints nothing and exits non-zero with the error', () => {
  const r = runExecute({ stderr: 'gh: Server Error (HTTP 500)', code: 1 })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /execute\.mjs: .*blocked_by.*HTTP 500/)
})

test('AC7: one row per Issue with the stages as columns and what a person does', () => {
  const md = report([
    { number: 61, start: 'implement', implement: { ok: true, branch: '61-a' }, openPr: { ok: true, pr: 120 }, verify: { verdict: 'PASS' } },
    { number: 64, start: 'implement', implement: { ok: false, reason: 'the spec does not match the code' } },
    { number: 70, start: 'open-pr', openPr: { ok: true, pr: 121 }, verify: { verdict: 'NEEDS-FIX' } },
    { number: 73, left: 'the PR author is not trusted: verify it with /macro-loop:verify' },
  ])
  const lines = md.trim().split('\n')
  assert.equal(lines[0], '| Issue | implement | open-pr | verify | What a person does |')
  assert.equal(lines.length, 6)
  assert.match(lines[2], /^\| #61 \| ✓ 61-a \| ✓ PR #120 \| ✓ PASS \| Read the verdict, mark the draft PR "Ready for review", then merge it \|$/)
  assert.match(lines[3], /^\| #64 \| ✗ the spec does not match the code \| · \| · \| Read why and decide \|$/)
  assert.match(lines[4], /^\| #70 \| not run \| ✓ PR #121 \| ✗ NEEDS-FIX \| Read the verdict, then run `\/macro-loop:execute 70` to fix it \|$/)
  assert.match(lines[5], /^\| #73 \| · \| · \| · \| Left out: the PR author is not trusted: verify it with \/macro-loop:verify \|$/)
})

// The workflow is a script the Workflow tool runs with these globals; the tests give stand-ins.
const WORKFLOW = join(ROOT, 'plugins/macro-loop/workflows/execute-run.js')
const AsyncFunction = (async () => {}).constructor
async function runWorkflow(issues, answer) {
  const src = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta =/m, 'const meta =')
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    return answer(prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const pipeline = async (items, ...stages) =>
    Promise.all(items.map(async (item, k) => {
      let v = item
      try {
        for (const s of stages) v = await s(v, item, k)
        return v
      } catch {
        return null
      }
    }))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', src)
  const value = await fn(agent, parallel, pipeline, () => {}, () => {}, { pluginRoot: '/p', base: 'main', issues }, { total: null }, null)
  return { value, calls, of: (n) => calls.filter((c) => c.opts.label.startsWith(`#${n} `)) }
}

const issue = (number, over = {}) => ({ number, slug: `s${number}`, spec: 9000 + number, start: 'implement', runSpecCommands: true, push: true, branch: null, pr: null, ...over })
const happy = (p, o) => {
  const n = Number(o.label.slice(1, o.label.indexOf(' ')))
  if (o.phase === 'implement') return { status: 'committed', branch: `${n}-s${n}`, head: `impl${n}`, reason: '' }
  if (o.phase === 'open-pr') return { status: 'opened', pr: 100 + n, head: `pr${n}`, reason: '' }
  return `report ${o.label}`
}

test('AC3: an Issue from implement goes implement → open-pr → verify, every row starting #<n>', async () => {
  const { value, calls } = await runWorkflow([issue(61)], happy)
  assert.deepEqual(calls.map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify', 'verify'])
  assert.deepEqual(calls.map((c) => c.opts.label), ['#61 s61', '#61 s61', '#61 s61 · spec', '#61 s61 · standards', '#61 s61 · security'])
  const impl = calls[0]
  assert.equal(impl.opts.isolation, 'worktree')
  assert.match(impl.prompt, /never edit the spec/i)
  assert.match(impl.prompt, /never push/i)
  assert.match(impl.prompt, /git branch -D/)
  assert.match(impl.prompt, /worktree-\* branch/)
  assert.match(calls[1].prompt, /approved the push up front/)
  assert.deepEqual(value, [{ number: 61, implement: { ok: true, branch: '61-s61', head: 'impl61' }, openPr: { ok: true, pr: 161, head: 'pr61' }, verify: { pr: 161, head: 'pr61', spec: 'report #61 s61 · spec', standards: 'report #61 s61 · standards', security: 'report #61 s61 · security' } }])
})

test('AC4: each Issue gets exactly two worktree verifiers with the identifier lines and its own head', async () => {
  const { of } = await runWorkflow([issue(61), issue(9, { start: 'verify', runSpecCommands: false, pr: { number: 10, head: 'ccc' } })], happy)
  for (const n of [61, 9]) {
    const v = of(n).filter((c) => c.opts.agentType === 'macro-loop:verifier')
    assert.equal(v.length, 2)
    for (const c of v) {
      assert.equal(c.opts.agentType, 'macro-loop:verifier')
      assert.equal(c.opts.isolation, 'worktree')
    }
  }
  const [s61, std61] = of(61).filter((c) => c.opts.agentType === 'macro-loop:verifier')
  assert.equal(s61.prompt, 'Axis: spec\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: pr61\nAnswers: none\nRun spec commands: yes\nRun tests and lint: yes')
  assert.equal(std61.prompt, 'Axis: standards\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: pr61\nAnswers: none')
  const [s9] = of(9).filter((c) => c.opts.phase === 'verify')
  assert.match(s9.prompt, /Head: ccc\nAnswers: none\nRun spec commands: no\nRun tests and lint: yes$/)
})

test('AC10 (#198): both verifiers of an Issue with a PR get its Answers line', async () => {
  const { of } = await runWorkflow([issue(9, { start: 'verify', pr: { number: 10, head: 'ccc', answersLine: '6631@abcdef0' } })], happy)
  const v = of(9).filter((c) => c.opts.agentType === 'macro-loop:verifier')
  assert.equal(v.length, 2)
  for (const c of v) assert.match(c.prompt, /^Answers: 6631@abcdef0$/m)
})

test('AC5: each Issue gets only its own stages in one run, and its result under its number', async () => {
  const { value, of } = await runWorkflow([issue(7), issue(70, { start: 'open-pr', branch: '70-x' }), issue(9, { start: 'verify', pr: { number: 10, head: 'ccc' } })], happy)
  assert.deepEqual(of(7).map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify', 'verify'])
  assert.deepEqual(of(70).map((c) => c.opts.phase), ['open-pr', 'verify', 'verify', 'verify'])
  assert.match(of(70)[0].prompt, /branch 70-x/)
  assert.deepEqual(of(9).map((c) => c.opts.phase), ['verify', 'verify', 'verify'])
  assert.deepEqual(value.map((r) => r.number), [7, 70, 9])
  assert.equal(value[1].implement, undefined)
  assert.deepEqual(Object.keys(value[2]), ['number', 'verify'])
  assert.equal(value[2].verify.pr, 10)
})

test('AC6: an Issue stops at the stage that cannot go on, and the others still go through every stage', async () => {
  const answer = (p, o) => {
    if (o.label === '#1 s1' && o.phase === 'implement') return { status: 'stopped', branch: '', head: '', reason: 'the spec does not match the code' }
    if (o.label === '#2 s2' && o.phase === 'implement') return null
    if (o.label === '#4 s4' && o.phase === 'open-pr') return { status: 'stopped', pr: 0, head: '', reason: 'push rejected' }
    return happy(p, o)
  }
  const { value, of } = await runWorkflow([issue(1), issue(2), issue(3, { push: false }), issue(4), issue(5)], answer)
  const by = Object.fromEntries(value.map((r) => [r.number, r]))
  assert.match(by[1].implement.reason, /spec does not match/)
  assert.match(by[2].implement.reason, /no result/)
  assert.match(by[3].openPr.reason, /push was declined: run \/macro-loop:open-pr 3-s3/)
  assert.match(by[4].openPr.reason, /push rejected/)
  for (const n of [1, 2, 3, 4]) {
    assert.equal(by[n].verify, undefined, n)
    assert.ok(!of(n).some((c) => c.opts.phase === 'verify'), n)
  }
  assert.ok(!of(3).some((c) => c.opts.phase === 'open-pr'))
  assert.deepEqual(of(5).map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify', 'verify'])
  assert.equal(by[5].verify.pr, 105)
})

test('AC6: no implement after a verdict, and verify posts nothing', async () => {
  const { calls } = await runWorkflow([issue(9, { start: 'verify', pr: { number: 10, head: 'ccc' } })], () => 'NEEDS-FIX')
  assert.ok(calls.every((c) => ['macro-loop:verifier', 'macro-loop:security-reviewer'].includes(c.opts.agentType)))
  assert.doesNotMatch(readFileSync(WORKFLOW, 'utf8'), /-X (POST|PATCH|PUT|DELETE)\b/)
})

const fixRound = (over = {}) => issue(8, { branch: '8-old', pr: { number: 20, head: 'old8', answersLine: null }, ...over })

test("#253 AC1: a fix round fetches the PR branch and detaches at its pushed tip, then deletes the worktree branch", async () => {
  const { of } = await runWorkflow([fixRound()], happy)
  const p = of(8)[0].prompt
  assert.match(p, /`git fetch origin 8-old`/)
  assert.match(p, /`git switch --detach origin\/8-old`/)
  assert.match(p, /`git branch -D <the branch you remembered>`/)
  assert.doesNotMatch(p, /git switch -c/)
  assert.doesNotMatch(p, /origin\/main/)
})

test('#253 AC2: a fix round runs trust.mjs for the PR, fixes the newest verdict, and posts no answer', async () => {
  const p = (await runWorkflow([fixRound()], happy)).of(8)[0].prompt
  assert.match(p, /`node \/p\/scripts\/trust\.mjs --issue 8 --pr 20`/)
  assert.match(p, /`pr\.lastVerdict`/)
  assert.match(p, /not marked "already answered"/)
  assert.match(p, /Post no answer comment/)
})

test("#253 AC3: a fix round whose commit is on another branch stops at implement, naming the PR's branch", async () => {
  const { value, of } = await runWorkflow([fixRound()], (p, o) => (o.phase === 'implement' ? { status: 'committed', branch: '8-s8', head: 'h', reason: '' } : happy(p, o)))
  assert.equal(value[0].implement.ok, false)
  assert.match(value[0].implement.reason, /8-old/)
  assert.deepEqual(of(8).map((c) => c.opts.phase), ['implement'])
})

test("#253 AC4: a fix round on the PR's branch is sent to open-pr, and verify judges open-pr's head", async () => {
  // The stand-in commits on whatever branch its prompt switches to.
  const answer = (p, o) => (o.phase === 'implement' ? { status: 'committed', branch: /Report (\S+) as the branch/.exec(p)[1], head: 'impl8', reason: '' } : happy(p, o))
  const { value, of } = await runWorkflow([fixRound()], answer)
  const [, open, ...verify] = of(8)
  assert.equal(open.opts.phase, 'open-pr')
  assert.match(open.prompt, /Push branch 8-old /)
  assert.equal(verify.length, 3)
  for (const c of verify) assert.match(c.prompt, /^Head: pr8$/m)
  assert.equal(value[0].verify.head, 'pr8')
})

test('#295 AC1: a fix round never switches to the PR branch, which another worktree may hold, and open-pr pushes its commit by sha', async () => {
  const answer = (p, o) => (o.phase === 'implement' ? { status: 'committed', branch: '8-old', head: 'impl8', reason: '' } : happy(p, o))
  const { value, of } = await runWorkflow([fixRound()], answer)
  const [impl, open] = of(8)
  assert.doesNotMatch(impl.prompt, /`git switch 8-old`/)
  assert.match(impl.prompt, /Commit on that detached HEAD and never switch to 8-old: another worktree may have it checked out/)
  assert.match(open.prompt, /`git push origin impl8:refs\/heads\/8-old`/)
  assert.match(open.prompt, /never with force/)
  assert.doesNotMatch(open.prompt, /push it by name/i)
  assert.deepEqual(value[0].implement, { ok: true, branch: '8-old', head: 'impl8' })
})

test('#295 AC1: a new branch is left detached once committed, so no worktree holds it, and open-pr pushes it by name', async () => {
  const { of } = await runWorkflow([issue(61)], happy)
  const [impl, open] = of(61)
  assert.match(impl.prompt, /Once you have committed, run `git switch --detach`, so that this worktree no longer holds 61-s61/)
  assert.match(open.prompt, /Push it by name\./)
  assert.doesNotMatch(open.prompt, /refs\/heads/)
})

test('#295 AC1: a fix round whose push was declined names the detached commit to push', async () => {
  const answer = (p, o) => (o.phase === 'implement' ? { status: 'committed', branch: '8-old', head: 'impl8', reason: '' } : happy(p, o))
  const { value } = await runWorkflow([fixRound({ push: false })], answer)
  assert.match(value[0].openPr.reason, /`git push origin impl8:refs\/heads\/8-old`/)
})

test('#295 AC2: a fix round still never creates or resets the PR branch, and stops when it cannot reach the pushed tip', async () => {
  const p = (await runWorkflow([fixRound()], happy)).of(8)[0].prompt
  assert.match(p, /Never create or reset 8-old; if the fetch or the switch fails, stop\./)
  assert.doesNotMatch(p, /git switch -c|git branch -f|git reset/)
  const { value, of } = await runWorkflow([fixRound()], (q, o) => (o.phase === 'implement' ? { status: 'stopped', branch: '', head: '', reason: 'fetch failed' } : happy(q, o)))
  assert.deepEqual(value[0].implement, { ok: false, reason: 'fetch failed' })
  assert.deepEqual(of(8).map((c) => c.opts.phase), ['implement'])
})

test('#253 AC5: an Issue at implement with no PR still makes a new branch from base, then deletes the worktree branch', async () => {
  const p = (await runWorkflow([issue(61)], happy)).of(61)[0].prompt
  assert.match(p, /`git switch -c 61-s61 origin\/main`, then `git branch -D <the branch you remembered>`/)
  assert.doesNotMatch(p, /trust\.mjs/)
})

test('the workflow: its name, its three phases in order, and a description that names no Issue', () => {
  const src = readFileSync(WORKFLOW, 'utf8')
  assert.match(src, /name: 'execute-run'/)
  assert.deepEqual([...src.matchAll(/title: '([\w-]+)'/g)].map((m) => m[1]), ['implement', 'open-pr', 'verify'])
  assert.doesNotMatch(/description: '([^']*)'/.exec(src)[1], /#\d/)
})

test('AC14: the workflow script holds no carriage return as checked out', () => {
  assert.ok(!readFileSync(WORKFLOW, 'utf8').includes('\r'), 'execute-run.js has CRLF line endings; see .gitattributes')
})

test('every line of the workflow verifier prompts is an identifier line from the hook module', async () => {
  const { isIdentifierLine } = await import(pathToFileURL(join(ROOT, 'plugins/macro-loop/scripts/identifier-lines.mjs')).href)
  const sha = (n) => String(n).padStart(40, 'a')
  const answer = (p, o) => {
    if (o.phase === 'implement') return { status: 'committed', branch: 'b', head: 'h', reason: '' }
    if (o.phase === 'open-pr') return { status: 'opened', pr: 1, head: sha(1), reason: '' }
    return 'report'
  }
  const { calls } = await runWorkflow([issue(1), issue(2, { start: 'verify', spec: null, runSpecCommands: false, pr: { number: 3, head: sha(2) } })], answer)
  const prompts = (agentType) => calls.filter((c) => c.opts.agentType === agentType).map((c) => c.prompt)
  assert.equal(prompts('macro-loop:verifier').length, 4)
  assert.equal(prompts('macro-loop:security-reviewer').length, 2)
  for (const type of ['macro-loop:verifier', 'macro-loop:security-reviewer']) {
    for (const l of prompts(type).flatMap((p) => p.split('\n'))) assert.ok(isIdentifierLine(l, type), l)
  }
})

test('#197 AC8: each PR gets one worktree security reviewer with Axis, Base and its own head, and its report comes back', async () => {
  const { value, of } = await runWorkflow([issue(61), issue(9, { start: 'verify', pr: { number: 10, head: 'ccc' } })], happy)
  for (const [n, head] of [[61, 'pr61'], [9, 'ccc']]) {
    const reviewers = of(n).filter((c) => c.opts.agentType === 'macro-loop:security-reviewer')
    assert.equal(reviewers.length, 1, n)
    assert.equal(reviewers[0].opts.isolation, 'worktree')
    assert.equal(reviewers[0].prompt, `Axis: security\nBase: origin/main\nHead: ${head}`)
  }
  assert.equal(value[1].verify.security, 'report #9 s9 · security')
})

test("#197 AC8: execute's step 4 passes the security report to verdict.mjs", () => {
  const skill = readFileSync(join(ROOT, 'plugins/macro-loop/skills/execute/SKILL.md'), 'utf8')
  const step = skill.slice(skill.indexOf('## 4.'), skill.indexOf('## 5.'))
  assert.match(step, /`spec`, `standards` and `security` reports/)
})
