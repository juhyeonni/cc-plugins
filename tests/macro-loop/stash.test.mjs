import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'plugins/macro-loop/scripts/stash.mjs')

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// A repo on `notes`, one commit ahead of `main`, as in the suite's A2.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'stash-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), '# demo\n')
  writeFileSync(join(dir, 'notes.txt'), 'notes\n')
  git(dir, 'add', 'README.md', 'notes.txt')
  git(dir, 'commit', '-qm', 'init')
  git(dir, 'switch', '-q', '-c', 'notes')
  writeFileSync(join(dir, 'README.md'), '# demo\nTalk notes.\n')
  git(dir, 'commit', '-qam', 'Add talk notes')
  return dir
}

// The user's work in progress: an unstaged change, a staged change and a staged new file.
function userChanges(dir) {
  writeFileSync(join(dir, 'README.md'), '# demo\nTalk notes.\nDraft: ask about accents.\n')
  writeFileSync(join(dir, 'notes.txt'), 'notes, staged\n')
  writeFileSync(join(dir, 'new.txt'), 'staged\n')
  git(dir, 'add', 'notes.txt', 'new.txt')
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' })
  return { ...r, out: r.status === 0 ? JSON.parse(r.stdout) : null }
}

// What implement does between the two calls: a branch of its own from main, with a commit.
function implement(dir) {
  git(dir, 'switch', '-q', '-c', '1-fix', 'main')
  writeFileSync(join(dir, 'fix.txt'), 'fixed\n')
  git(dir, 'add', 'fix.txt')
  git(dir, 'commit', '-qm', 'Fix #1')
}

const state = (dir) => ({
  branch: git(dir, 'branch', '--show-current'),
  head: git(dir, 'rev-parse', 'HEAD'),
  status: git(dir, 'status', '--porcelain'),
  stash: git(dir, 'stash', 'list', '--format=%H %gs'),
})

test('save prints the entry hash and the branch, and stashes with the message', () => {
  const dir = repo()
  userChanges(dir)
  const r = run(dir, 'save', '--issue', '1')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.out.entry, /^[0-9a-f]{40}$/)
  assert.equal(r.out.branch, 'notes')
  assert.equal(git(dir, 'stash', 'list', '--format=%H %gs'), `${r.out.entry} On notes: macro-loop: implement #1`)
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('restore switches back to the branch and puts back staged and unstaged changes alike', () => {
  const dir = repo()
  userChanges(dir)
  const before = state(dir)
  const { entry } = run(dir, 'save', '--issue', '1').out
  implement(dir)
  const r = run(dir, 'restore', '--entry', entry)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out, { restored: entry, branch: 'notes' })
  assert.deepEqual(state(dir), before)
  assert.equal(git(dir, 'stash', 'list'), '')
})

test('another entry added between save and restore is kept, and only this entry is dropped', () => {
  const dir = repo()
  userChanges(dir)
  const { entry } = run(dir, 'save', '--issue', '1').out
  const other = join(dir, '..', `${dir.split('/').pop()}-other`)
  git(dir, 'worktree', 'add', '-q', '--detach', other, 'main')
  writeFileSync(join(other, 'scratch.txt'), 'scratch\n')
  git(other, 'add', 'scratch.txt')
  git(other, 'stash', 'push', '-q', '-m', 'other session: keep me')
  implement(dir)
  const r = run(dir, 'restore', '--entry', entry)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(git(dir, 'stash', 'list', '--format=%gs').split('\n'), ['On (no branch): other session: keep me'])
})

// A refusal leaves the branch, HEAD, working tree and stash as they were.
function refuses(dir, args, pattern) {
  const before = state(dir)
  const r = run(dir, ...args)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, pattern)
  assert.deepEqual(state(dir), before)
}

test('restore refuses when the branch has moved since the save, and says how to apply by hand', () => {
  const dir = repo()
  userChanges(dir)
  const { entry } = run(dir, 'save', '--issue', '1').out
  writeFileSync(join(dir, 'README.md'), '# demo\nTalk notes, revised elsewhere.\n')
  git(dir, 'commit', '-qam', 'Another session moved notes')
  implement(dir)
  refuses(dir, ['restore', '--entry', entry], new RegExp(`notes has moved.*git stash apply --index ${entry}`))
})

test('restore refuses an unknown hash, an entry save did not make, and tracked changes in the way', () => {
  const dir = repo()
  refuses(dir, ['restore', '--entry', 'f'.repeat(40)], /is not in the stash/)
  writeFileSync(join(dir, 'README.md'), 'by hand\n')
  git(dir, 'stash', 'push', '-q', '-m', 'made by hand')
  refuses(dir, ['restore', '--entry', git(dir, 'rev-parse', 'stash@{0}')], /was not made by stash\.mjs save/)
  git(dir, 'stash', 'drop', '-q')
  userChanges(dir)
  const { entry } = run(dir, 'save', '--issue', '1').out
  implement(dir)
  writeFileSync(join(dir, 'fix.txt'), 'not committed\n')
  refuses(dir, ['restore', '--entry', entry], /changes to tracked files/)
})

test('save refuses with nothing to stash and on a detached HEAD', () => {
  const dir = repo()
  refuses(dir, ['save', '--issue', '1'], /no changes to tracked files/)
  git(dir, 'switch', '-q', '--detach', 'HEAD')
  writeFileSync(join(dir, 'README.md'), 'changed\n')
  refuses(dir, ['save', '--issue', '1'], /HEAD is detached/)
})

test('untracked files are neither stashed nor touched', () => {
  const dir = repo()
  userChanges(dir)
  writeFileSync(join(dir, 'untracked.txt'), 'mine\n')
  const { entry } = run(dir, 'save', '--issue', '1').out
  assert.equal(readFileSync(join(dir, 'untracked.txt'), 'utf8'), 'mine\n')
  implement(dir)
  assert.equal(run(dir, 'restore', '--entry', entry).status, 0)
  assert.equal(readFileSync(join(dir, 'untracked.txt'), 'utf8'), 'mine\n')
  assert.match(git(dir, 'status', '--porcelain'), /^\?\? untracked\.txt$/m)
})

test('arguments that are not an Issue number or a full hash are refused before any change', () => {
  const dir = repo()
  userChanges(dir)
  refuses(dir, ['save', '--issue', '1; rm -rf /'], /usage/)
  refuses(dir, ['restore', '--entry', 'stash@{0}'], /usage/)
  refuses(dir, ['pop'], /usage/)
})
