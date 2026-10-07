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

// The workflows are scripts the Workflow tool runs with these globals; the tests give stand-ins.
const AsyncFunction = (async () => {}).constructor
function runWorkflow(name, args, answer) {
  const src = readFileSync(join(ROOT, 'plugins/macro-loop/workflows', name), 'utf8').replace(/^export const meta =/m, 'const meta =')
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    return answer(prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const pipeline = async (items, ...stages) =>
    Promise.all(items.map(async (item, i) => {
      let v = item
      try {
        for (const s of stages) v = await s(v, item, i)
        return v
      } catch {
        return null
      }
    }))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', src)
  const result = fn(agent, parallel, pipeline, () => {}, () => {}, args, { total: null }, null)
  return result.then((value) => ({ value, calls, meta: src }))
}

const issue = (number, over = {}) => ({ number, slug: `s${number}`, spec: 1000 + number, runSpecCommands: true, ...over })

test('AC3: the implement workflow starts one worktree agent per Issue, labelled implement, phase #n, never pushing', async () => {
  const { calls } = await runWorkflow('execute-implement.js', { pluginRoot: '/p', base: 'main', issues: [issue(61), issue(64)] }, (p, o) => ({ status: 'committed', branch: `${o.phase.slice(1)}-x`, head: 'abc', reason: '' }))
  assert.equal(calls.length, 2)
  for (const [i, n] of [61, 64].entries()) {
    assert.equal(calls[i].opts.isolation, 'worktree')
    assert.equal(calls[i].opts.label, 'implement')
    assert.equal(calls[i].opts.phase, `#${n}`)
    assert.match(calls[i].prompt, /never push/i)
    assert.match(calls[i].prompt, new RegExp(`#${n}\\b`))
  }
})

const VERIFY_ARGS = {
  base: 'origin/main',
  issues: [
    { number: 61, spec: 9061, head: 'aaa', runSpecCommands: true },
    { number: 70, spec: 9070, head: 'bbb', runSpecCommands: false },
  ],
}

test('AC4: the verify workflow starts two verifiers per Issue with identifier lines only', async () => {
  const { calls } = await runWorkflow('execute-verify.js', VERIFY_ARGS, () => 'report')
  assert.equal(calls.length, 4)
  for (const c of calls) {
    assert.equal(c.opts.agentType, 'macro-loop:verifier')
    assert.equal(c.opts.isolation, 'worktree')
  }
  const spec61 = calls.find((c) => c.opts.phase === '#61' && c.prompt.startsWith('Axis: spec'))
  assert.equal(spec61.prompt, 'Axis: spec\nIssue: #61\nSpec comment: 9061\nBase: origin/main\nHead: aaa\nRun spec commands: yes\nRun tests and lint: yes')
  const spec70 = calls.find((c) => c.opts.phase === '#70' && c.prompt.startsWith('Axis: spec'))
  assert.match(spec70.prompt, /Run spec commands: no\nRun tests and lint: yes$/)
  const std70 = calls.find((c) => c.opts.phase === '#70' && c.prompt.startsWith('Axis: standards'))
  assert.equal(std70.prompt, 'Axis: standards\nIssue: #70\nSpec comment: 9070\nBase: origin/main\nHead: bbb')
})

test('AC5: one Issue failing leaves the others running and returns its reason', async () => {
  const answer = (p, o) => {
    if (o.phase === '#64') throw new Error('boom')
    if (o.phase === '#65') return { status: 'stopped', branch: '', head: '', reason: 'the spec does not match the code' }
    return { status: 'committed', branch: '61-x', head: 'abc', reason: '' }
  }
  const { value, calls } = await runWorkflow('execute-implement.js', { pluginRoot: '/p', base: 'main', issues: [issue(61), issue(64), issue(65)] }, answer)
  assert.equal(calls.length, 3)
  const by = Object.fromEntries(value.map((r) => [r.number, r]))
  assert.equal(by[61].status, 'committed')
  assert.equal(by[64].status, 'stopped')
  assert.match(by[64].reason, /no result/)
  assert.equal(by[65].reason, 'the spec does not match the code')
})

test('AC6: neither workflow implements again after a verdict, pushes, or posts to GitHub', async () => {
  const { calls, meta } = await runWorkflow('execute-verify.js', VERIFY_ARGS, () => 'NEEDS-FIX')
  assert.ok(calls.every((c) => c.opts.agentType === 'macro-loop:verifier'))
  const impl = readFileSync(join(ROOT, 'plugins/macro-loop/workflows/execute-implement.js'), 'utf8')
  for (const src of [meta, impl]) {
    assert.doesNotMatch(src, /`git push|-X (POST|PATCH|PUT|DELETE)\b/)
  }
})

test('workflows: fixed names and phases', async () => {
  for (const [file, name, ph] of [['execute-implement.js', 'execute-implement', 'implement'], ['execute-verify.js', 'execute-verify', 'verify']]) {
    const src = readFileSync(join(ROOT, 'plugins/macro-loop/workflows', file), 'utf8')
    assert.match(src, new RegExp(`name: '${name}'`))
    assert.match(src, new RegExp(`title: '${ph}'`))
  }
})
