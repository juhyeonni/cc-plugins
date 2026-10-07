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
  assert.deepEqual(calls.map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify'])
  assert.deepEqual(calls.map((c) => c.opts.label), ['#61 implement', '#61 open-pr', '#61 verify · spec', '#61 verify · standards'])
  const impl = calls[0]
  assert.equal(impl.opts.isolation, 'worktree')
  assert.match(impl.prompt, /never edit the spec/i)
  assert.match(impl.prompt, /never push/i)
  assert.match(impl.prompt, /git branch -D/)
  assert.match(impl.prompt, /worktree-\* branch/)
  assert.match(calls[1].prompt, /approved the push up front/)
  assert.deepEqual(value, [{ number: 61, implement: { ok: true, branch: '61-s61', head: 'impl61' }, openPr: { ok: true, pr: 161, head: 'pr61' }, verify: { pr: 161, head: 'pr61', spec: 'report #61 verify · spec', standards: 'report #61 verify · standards' } }])
})

test('AC4: each Issue gets exactly two worktree verifiers with the identifier lines and its own head', async () => {
  const { of } = await runWorkflow([issue(61), issue(9, { start: 'verify', runSpecCommands: false, pr: { number: 10, head: 'ccc' } })], happy)
  for (const n of [61, 9]) {
    const v = of(n).filter((c) => c.opts.phase === 'verify')
    assert.equal(v.length, 2)
    for (const c of v) {
      assert.equal(c.opts.agentType, 'macro-loop:verifier')
      assert.equal(c.opts.isolation, 'worktree')
    }
  }
  const [s61, std61] = of(61).filter((c) => c.opts.phase === 'verify')
  assert.equal(s61.prompt, 'Axis: spec\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: pr61\nRun spec commands: yes\nRun tests and lint: yes')
  assert.equal(std61.prompt, 'Axis: standards\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: pr61')
  const [s9] = of(9).filter((c) => c.opts.phase === 'verify')
  assert.match(s9.prompt, /Head: ccc\nRun spec commands: no\nRun tests and lint: yes$/)
})

test('AC5: each Issue gets only its own stages in one run, and its result under its number', async () => {
  const { value, of } = await runWorkflow([issue(7), issue(70, { start: 'open-pr', branch: '70-x' }), issue(9, { start: 'verify', pr: { number: 10, head: 'ccc' } })], happy)
  assert.deepEqual(of(7).map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify'])
  assert.deepEqual(of(70).map((c) => c.opts.phase), ['open-pr', 'verify', 'verify'])
  assert.match(of(70)[0].prompt, /branch 70-x/)
  assert.deepEqual(of(9).map((c) => c.opts.phase), ['verify', 'verify'])
  assert.deepEqual(value.map((r) => r.number), [7, 70, 9])
  assert.equal(value[1].implement, undefined)
  assert.deepEqual(Object.keys(value[2]), ['number', 'verify'])
  assert.equal(value[2].verify.pr, 10)
})

test('AC6: an Issue stops at the stage that cannot go on, and the others still go through every stage', async () => {
  const answer = (p, o) => {
    if (o.label === '#1 implement') return { status: 'stopped', branch: '', head: '', reason: 'the spec does not match the code' }
    if (o.label === '#2 implement') return null
    if (o.label === '#4 open-pr') return { status: 'stopped', pr: 0, head: '', reason: 'push rejected' }
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
  assert.deepEqual(of(5).map((c) => c.opts.phase), ['implement', 'open-pr', 'verify', 'verify'])
  assert.equal(by[5].verify.pr, 105)
})

test('AC6: no implement after a verdict, and verify posts nothing', async () => {
  const { calls } = await runWorkflow([issue(9, { start: 'verify', pr: { number: 10, head: 'ccc' } })], () => 'NEEDS-FIX')
  assert.ok(calls.every((c) => c.opts.agentType === 'macro-loop:verifier'))
  assert.doesNotMatch(readFileSync(WORKFLOW, 'utf8'), /-X (POST|PATCH|PUT|DELETE)\b/)
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
