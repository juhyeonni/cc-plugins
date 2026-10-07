import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { candidates, specCommands, report } = await import(pathToFileURL(join(ROOT, 'plugins/macro-loop/scripts/execute.mjs')).href)

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
const WORKFLOW = join(ROOT, 'plugins/macro-loop/workflows/execute-issue.js')
const AsyncFunction = (async () => {}).constructor
async function runWorkflow(issue, answer) {
  const src = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta =/m, 'const meta =')
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    return answer(prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', src)
  const value = await fn(agent, parallel, null, () => {}, () => {}, { pluginRoot: '/p', base: 'main', issue }, { total: null }, null)
  return { value, calls }
}

const issue = (over = {}) => ({ number: 61, slug: 'add-a', spec: 9061, start: 'implement', runSpecCommands: true, push: true, branch: null, pr: null, ...over })
const happy = (p, o) => {
  if (o.phase === 'implement') return { status: 'committed', branch: '61-add-a', head: 'aaa', reason: '' }
  if (o.phase === 'open-pr') return { status: 'opened', pr: 120, head: 'bbb', reason: '' }
  return `report ${o.label}`
}

test('AC3: a run from implement goes implement → open-pr → verify, one worktree implement agent first', async () => {
  const { value, calls } = await runWorkflow(issue(), happy)
  assert.deepEqual(calls.map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify'])
  const impl = calls[0]
  assert.equal(impl.opts.isolation, 'worktree')
  assert.match(impl.prompt, /never edit the spec/i)
  assert.match(impl.prompt, /never push/i)
  assert.match(impl.prompt, /git branch -D/)
  assert.match(impl.prompt, /worktree-\* branch/)
  assert.match(calls[1].prompt, /approved the push up front/)
  assert.deepEqual(value.implement, { ok: true, branch: '61-add-a', head: 'aaa' })
  assert.deepEqual(value.openPr, { ok: true, pr: 120, head: 'bbb' })
  assert.equal(value.verify.pr, 120)
})

test('AC4: verify starts exactly two worktree verifiers with the identifier lines and the head from open-pr', async () => {
  const { calls, value } = await runWorkflow(issue(), happy)
  const v = calls.filter((c) => c.opts.phase === 'verify')
  assert.equal(v.length, 2)
  for (const c of v) {
    assert.equal(c.opts.agentType, 'macro-loop:verifier')
    assert.equal(c.opts.isolation, 'worktree')
  }
  assert.equal(v[0].prompt, 'Axis: spec\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: bbb\nRun spec commands: yes\nRun tests and lint: yes')
  assert.equal(v[1].prompt, 'Axis: standards\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: bbb')
  assert.equal(value.verify.spec, 'report #61 verify · spec')
  const { calls: noRun } = await runWorkflow(issue({ start: 'verify', runSpecCommands: false, pr: { number: 10, head: 'ccc' } }), happy)
  assert.match(noRun[0].prompt, /Head: ccc\nRun spec commands: no\nRun tests and lint: yes$/)
})

test('AC5: a run from open-pr starts no implement agent, one from verify only the two verifiers', async () => {
  const fromPr = await runWorkflow(issue({ start: 'open-pr', branch: '70-x' }), happy)
  assert.deepEqual(fromPr.calls.map((c) => c.opts.phase), ['open-pr', 'verify', 'verify'])
  assert.match(fromPr.calls[0].prompt, /branch 70-x/)
  assert.equal(fromPr.value.implement, undefined)
  const fromVerify = await runWorkflow(issue({ start: 'verify', pr: { number: 10, head: 'ccc' } }), happy)
  assert.deepEqual(fromVerify.calls.map((c) => c.opts.phase), ['verify', 'verify'])
  assert.equal(fromVerify.value.verify.pr, 10)
})

test('AC6: a run stops at the stage that cannot go on, with its reason, and starts no later phase', async () => {
  const cases = [
    [issue(), (p, o) => (o.phase === 'implement' ? { status: 'stopped', branch: '', head: '', reason: 'the spec does not match the code' } : happy(p, o)), 'implement', /spec does not match/],
    [issue(), (p, o) => (o.phase === 'implement' ? null : happy(p, o)), 'implement', /no result/],
    [issue({ push: false }), happy, 'openPr', /push was declined: run \/macro-loop:open-pr 61-add-a/],
    [issue(), (p, o) => (o.phase === 'open-pr' ? { status: 'stopped', pr: 0, head: '', reason: 'push rejected' } : happy(p, o)), 'openPr', /push rejected/],
  ]
  for (const [args, answer, stage, reason] of cases) {
    const { value, calls } = await runWorkflow(args, answer)
    assert.equal(value[stage].ok, false)
    assert.match(value[stage].reason, reason)
    assert.equal(value.verify, undefined)
    assert.ok(!calls.some((c) => c.opts.phase === 'verify'))
  }
  const declined = await runWorkflow(issue({ push: false }), happy)
  assert.ok(!declined.calls.some((c) => c.opts.phase === 'open-pr'))
})

test('AC6: no implement after a verdict, and verify posts nothing', async () => {
  const { calls } = await runWorkflow(issue({ start: 'verify', pr: { number: 10, head: 'ccc' } }), () => 'NEEDS-FIX')
  assert.ok(calls.every((c) => c.opts.agentType === 'macro-loop:verifier'))
  const src = readFileSync(WORKFLOW, 'utf8')
  assert.doesNotMatch(src, /-X (POST|PATCH|PUT|DELETE)\b/)
})

test('the workflow: its name and its three phases, in order', () => {
  const src = readFileSync(WORKFLOW, 'utf8')
  assert.match(src, /name: 'execute-issue'/)
  const titles = [...src.matchAll(/title: '([\w-]+)'/g)].map((m) => m[1])
  assert.deepEqual(titles, ['implement', 'open-pr', 'verify'])
})

test('AC14: the workflow script holds no carriage return as checked out', () => {
  assert.ok(!readFileSync(WORKFLOW, 'utf8').includes('\r'), 'execute-issue.js has CRLF line endings; see .gitattributes')
})
