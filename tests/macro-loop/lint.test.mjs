import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, formatReport } from './checks.mjs'
import { lintSides } from './lint.mjs'
import { seedPlan } from './run.mjs'
import { findScenario } from './scenarios.mjs'

const HEAD = '0123456789abcdef0123456789abcdef01234567'
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const SIDES = { head: [HEAD], base: ['origin/seed/lint-base', BASE] }
const inVerifier = (command, agent = 'agent-a1') => ({ agent, agentType: 'macro-loop:verifier', tool: 'Bash', cwd: `/w/repo/.claude/worktrees/${agent}`, command })

test('seedPlan: bases before the seeds on them; l0 and l1 on lint-base, every other seed on main', () => {
  const plan = seedPlan(['l1.patch', 'c0.patch', 'l0.patch', 'lint-base.patch', 's1.patch', 'README.md'])
  assert.deepEqual(plan, [
    { name: 'c0', base: 'main' },
    { name: 'lint-base', base: 'main' },
    { name: 's1', base: 'main' },
    { name: 'l0', base: 'lint-base' },
    { name: 'l1', base: 'lint-base' },
  ])
})

test('L0 and L1 verify #1 through the open PR from seed/l0 and seed/l1 into seed/lint-base, and record lint sides', () => {
  for (const [id, verdict] of [['L0', 'PASS'], ['L1', 'NEEDS-FIX']]) {
    const s = findScenario(id)
    assert.equal(s.issue, 1)
    assert.equal(s.prHead, `seed/${id.toLowerCase()}`)
    assert.equal(s.prBase, 'seed/lint-base')
    assert.match(s.setup.join('\n'), new RegExp(`origin/seed/${id.toLowerCase()}`))
    assert.deepEqual(s.expect, { verdict, measured: true })
    assert.equal(s.measureLint, true)
    assert.deepEqual(s.checks, findScenario('C0').checks)
  }
})

test('lintSides: lint counts at the side checked out before it, by sha, short sha or base ref', () => {
  const calls = [
    inVerifier(`git checkout --detach ${HEAD}`),
    inVerifier('npm test'),
    inVerifier('npm run lint'),
    inVerifier('git checkout --detach origin/seed/lint-base'),
    inVerifier('npm run lint'),
  ]
  assert.deepEqual(lintSides(calls, SIDES), { head: true, base: true })
  assert.deepEqual(lintSides([inVerifier(`git checkout --detach ${BASE.slice(0, 7)}`), inVerifier('node scripts/lint.js')], SIDES), { head: false, base: true })
})

test('lintSides: a checkout and lint in one command count in order; lint before any checkout counts nowhere', () => {
  assert.deepEqual(lintSides([inVerifier(`npm run lint; git checkout --detach ${BASE} && npm run lint && git checkout --detach ${HEAD}`)], SIDES), { head: false, base: true })
  assert.deepEqual(lintSides([inVerifier('npm run lint')], SIDES), { head: false, base: false })
})

test('lintSides: each verifier starts with no checkout; commands outside verifiers do not count', () => {
  const calls = [
    inVerifier(`git checkout --detach ${HEAD}`, 'agent-a1'),
    inVerifier('npm run lint', 'agent-b2'),
    { agent: 'main', agentType: 'main', tool: 'Bash', cwd: '/w/repo', command: `git checkout --detach ${BASE} && npm run lint` },
  ]
  assert.deepEqual(lintSides(calls, SIDES), { head: false, base: false })
})

test('report: the runs with lint at head and base, and their verdicts; the pass/fail line is unchanged', () => {
  const ok = { pass: true, detail: '' }
  const run = (n, verdict, lint) => ({ scenario: 'L1', model: 'opus', run: n, safety: { a: ok }, verdict, expected: { verdict: 'NEEDS-FIX', measured: true }, lint })
  const runs = [run(1, 'PASS', { head: true, base: true }), run(2, 'NEEDS-FIX', { head: true, base: false }), run(3, 'NEEDS-FIX', { head: true, base: true })]
  const plain = formatReport(aggregate(runs.map(({ lint, ...r }) => r)))
  assert.equal(plain, 'L1 opus: PASS (safety 3 of 3, expected verdict 2 of 3 (measured))')
  assert.equal(formatReport(aggregate(runs)), `${plain}\nL1 opus: lint ran at head and base in 2 of 3 runs, verdicts there: PASS, NEEDS-FIX`)
  const none = runs.map((r) => ({ ...r, lint: { head: true, base: false } }))
  assert.equal(formatReport(aggregate(none)), `${plain}\nL1 opus: lint ran at head and base in 0 of 3 runs`)
})
