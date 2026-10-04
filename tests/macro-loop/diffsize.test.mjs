import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregate, formatReport } from './checks.mjs'
import { branchTips, countLines, measureDiff, pickBranch } from './diffsize.mjs'

const SEEDS = join(dirname(fileURLToPath(import.meta.url)), 'seeds')
const size = (code, comment, testLines = [0, 0], other = [0, 0]) => {
  const pair = ([added, removed]) => ({ added, removed })
  return { code: pair(code), test: pair(testLines), comment: pair(comment), other: pair(other) }
}

test('countLines: the c0 seed is code +3/-1 and comment +2/-1', () => {
  assert.deepEqual(countLines(readFileSync(join(SEEDS, 'c0.patch'), 'utf8')), size([3, 1], [2, 1]))
})

test('countLines: test files count as test, comments included; other files as other; blank lines not at all', () => {
  const diff = [
    'diff --git a/test/slugify.test.js b/test/slugify.test.js',
    '--- a/test/slugify.test.js',
    '+++ b/test/slugify.test.js',
    '@@ -1,2 +1,5 @@',
    "+// dashes collapse",
    "+test('a  b', () => {})",
    '+',
    '-old()',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1,3 @@',
    '+## Usage',
    '+',
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1 +1 @@',
    '-  "version": "1.0.0"',
    '+  "version": "1.1.0"',
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1 +1,4 @@',
    '+/**',
    '+ * Docs.',
    '+ */',
    '+++x',
  ].join('\n')
  assert.deepEqual(countLines(diff), size([1, 0], [3, 0], [2, 1], [2, 1]))
})

test('pickBranch: the one branch that appeared or moved, ignoring worktree-agent-*', () => {
  const before = { main: 'm', notes: 'n' }
  assert.deepEqual(pickBranch(before, { ...before, '1-collapse-dashes': 'x', 'worktree-agent-a1': 'w' }), { branch: '1-collapse-dashes', base: null })
  assert.deepEqual(pickBranch(before, { main: 'm', notes: 'n2' }), { branch: 'notes', base: 'n' })
})

test('pickBranch: no branch, or two, that appeared or moved gives a reason instead of a branch', () => {
  const before = { main: 'm' }
  assert.deepEqual(pickBranch(before, before), { reason: 'no branch appeared or moved' })
  assert.deepEqual(pickBranch(before, { main: 'm', a: 'x', b: 'y' }), { reason: '2 branches appeared or moved: a, b' })
})

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'diffsize-'))
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'test'], ['config', 'commit.gpgsign', 'false']]) git(...args)
  const commit = (file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
    git('add', file)
    git('commit', '-qm', file)
  }
  return { dir, git, commit }
}

test('measureDiff: a new branch from its merge-base with origin/main, a moved branch from its old tip', () => {
  const { dir, git, commit } = repo()
  commit('src/a.js', 'a()\n')
  git('update-ref', 'refs/remotes/origin/main', 'main')
  const before = branchTips(dir)
  git('switch', '-q', '-c', '1-fix')
  commit('src/a.js', 'a()\nb()\nc()\n')
  // origin/main moving on afterwards does not count against the branch.
  git('switch', '-q', '--detach', 'main')
  commit('src/z.js', 'z()\n')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('switch', '-q', '1-fix')
  const created = measureDiff(dir, before, branchTips(dir)).diff
  assert.equal(created.branch, '1-fix')
  assert.equal(created.from, before.main)
  assert.deepEqual(created.lines, size([2, 0], [0, 0]))

  const started = branchTips(dir)
  commit('src/a.js', 'a()\nb()\nc()\nd()\n')
  const moved = measureDiff(dir, started, branchTips(dir)).diff
  assert.equal(moved.branch, '1-fix')
  assert.equal(moved.from, started['1-fix'])
  assert.deepEqual(moved.lines, size([1, 0], [0, 0]))
})

test('measureDiff: no branch to measure gives a null diff with the reason', () => {
  const { dir, commit } = repo()
  commit('src/a.js', 'a()\n')
  const tips = branchTips(dir)
  assert.deepEqual(measureDiff(dir, tips, tips), { diff: null, diffReason: 'no branch appeared or moved' })
})

test('report: a measured scenario lists added code lines per run; the pass/fail line is unchanged', () => {
  const ok = { pass: true, detail: '' }
  const run = (n, diff) => ({ scenario: 'A2', model: 'opus', run: n, safety: { a: ok }, verdict: 'PASS', expected: { verdict: 'PASS' }, ...diff })
  const lines = (added) => ({ diff: { lines: size([added, 0], [0, 0]) } })
  const measured = [run(1, lines(3)), run(2, lines(8)), run(3, { diff: null, diffReason: 'no branch appeared or moved' })]
  const unmeasured = measured.map(({ diff, diffReason, ...r }) => r)
  const plain = formatReport(aggregate(unmeasured))
  assert.equal(plain, 'A2 opus: PASS (safety 3 of 3, expected verdict 3 of 3)')
  assert.equal(formatReport(aggregate(measured)), `${plain}\nA2 opus: diff size, code lines added per run: 3, 8, none`)
})
