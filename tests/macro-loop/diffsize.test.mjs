import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { branchTips, countPatch, measureDiff } from './diffsize.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const z = { add: 0, del: 0 }

test('c0 seed patch: code +3/-1, comment +2/-1', () => {
  const c = countPatch(readFileSync(join(here, 'seeds/c0.patch'), 'utf8'))
  assert.deepEqual(c, { code: { add: 3, del: 1 }, comment: { add: 2, del: 1 }, test: z, other: z })
})

test('test files count as test, Markdown and JSON as other, blank lines not at all', () => {
  const patch = [
    'diff --git a/test/a.test.js b/test/a.test.js', '@@ -0,0 +1,3 @@', '+// note', '+assert(1)', '+',
    'diff --git a/README.md b/README.md', '@@ -1 +1,2 @@', '-old', '+new', '+',
    'diff --git a/package.json b/package.json', '@@ -1 +1 @@', '+{}',
  ].join('\n')
  assert.deepEqual(countPatch(patch), { code: z, comment: z, test: { add: 2, del: 0 }, other: { add: 2, del: 1 } })
})

function repoWith() {
  const dir = mkdtempSync(join(tmpdir(), 'diffsize-'))
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/a.js'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  const commit = (branch, line) => {
    git('switch', '-q', branch)
    writeFileSync(join(dir, 'src/a.js'), `${line}\n`, { flag: 'a' })
    git('commit', '-qam', line)
  }
  return { dir, git, commit }
}

test('a new branch is measured from its merge-base, a moved branch from its old tip, worktree-agent-* ignored', () => {
  const { dir, git, commit } = repoWith()
  const before = branchTips(dir)
  git('switch', '-qc', 'new'); commit('new', 'two')
  git('branch', 'worktree-agent-x', 'main')
  commit('worktree-agent-x', 'noise')
  const added = measureDiff(dir, before, branchTips(dir))
  assert.deepEqual(added.diff, { branch: 'new', code: { add: 1, del: 0 }, test: z, comment: z, other: z })

  const mid = branchTips(dir)
  commit('new', 'three'); commit('new', 'four')
  assert.equal(measureDiff(dir, mid, branchTips(dir)).diff.code.add, 2)
})

test('no branch, or two branches, appeared or moved: diff is null with a reason', () => {
  const { dir, git, commit } = repoWith()
  const before = branchTips(dir)
  assert.match(measureDiff(dir, before, branchTips(dir)).reason, /0 branches/)
  git('branch', 'p', 'main'); git('branch', 'q', 'main')
  commit('p', 'x'); commit('q', 'y')
  const r = measureDiff(dir, before, branchTips(dir))
  assert.equal(r.diff, null)
  assert.match(r.reason, /2 branches/)
})
