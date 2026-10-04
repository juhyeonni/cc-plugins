import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HOOK = join(ROOT, 'plugins/macro-loop/scripts/verifier-cleanup.mjs')
const ID = 'a88ecdfd82743e9f2'
const BRANCH = `worktree-agent-${ID}`

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// A checkout of a bare `origin` with `main` pushed; the user's linked worktree on `notes`; and
// an agent's worktree as Claude Code holds it when the agent stops: made from origin/main on
// worktree-agent-<id>, detached, as a verifier's checkout of the PR's head leaves it, and locked.
function repo() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cleanup-')))
  const main = join(tmp, 'main')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  git(tmp, 'init', '-q', '-b', 'main', 'main')
  git(main, 'config', 'user.email', 'test@example.com')
  git(main, 'config', 'user.name', 'test')
  git(main, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(main, 'README.md'), '# demo\n')
  git(main, 'add', 'README.md')
  git(main, 'commit', '-qm', 'init')
  git(main, 'remote', 'add', 'origin', join(tmp, 'origin.git'))
  git(main, 'push', '-q', '-u', 'origin', 'main')
  const linked = join(tmp, 'linked')
  git(main, 'worktree', 'add', '-q', '-b', 'notes', linked)
  const worktree = join(main, '.claude', 'worktrees', `agent-${ID}`)
  git(main, 'worktree', 'add', '-q', '-b', BRANCH, worktree, 'origin/main')
  git(worktree, 'switch', '-q', '--detach')
  git(main, 'worktree', 'lock', '--reason', `claude agent agent-${ID} (pid ${process.pid})`, worktree)
  return { tmp, main, linked, worktree }
}

// The worktrees git has registered, a locked one marked, and the local branches.
const state = (main) => ({
  worktrees: git(main, 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .map((block) => block.split('\n'))
    .map(([first, ...rest]) => first.slice('worktree '.length) + (rest.some((l) => l.startsWith('locked')) ? ' (locked)' : '')),
  branches: git(main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n'),
})

// Runs the hook as Claude Code does when an agent stops: the SubagentStop input on stdin, by
// default for the verifier. The hook itself runs in a folder outside the repo, so only the
// input's cwd can lead it there.
function hook(tmp, cwd, fields = {}) {
  const input = {
    session_id: 's',
    transcript_path: join(tmp, 'session.jsonl'),
    cwd,
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_id: ID,
    agent_type: 'macro-loop:verifier',
    agent_transcript_path: join(tmp, `agent-${ID}.jsonl`),
    last_assistant_message: 'report',
    ...fields,
  }
  const r = spawnSync(process.execPath, [HOOK], { cwd: tmp, input: JSON.stringify(input), encoding: 'utf8' })
  return { ...r, out: r.stdout ? JSON.parse(r.stdout) : null }
}

test('a verifier that stops with its worktree still there and locked: the worktree is removed and its branch deleted', () => {
  // Its cwd is its worktree, or a folder in it after a `cd`.
  for (const folder of ['', 'src']) {
    const dirs = repo()
    // Files a check changed or left behind.
    writeFileSync(join(dirs.worktree, 'README.md'), '# demo\nchanged by a check\n')
    mkdirSync(join(dirs.worktree, 'src'))
    writeFileSync(join(dirs.worktree, 'src', 'out.txt'), 'left by a check\n')
    assert.deepEqual(state(dirs.main).worktrees, [dirs.main, dirs.linked, `${dirs.worktree} (locked)`])
    const r = hook(dirs.tmp, join(dirs.worktree, folder))
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', folder)
    assert.equal(existsSync(dirs.worktree), false, folder)
    assert.deepEqual(state(dirs.main), { worktrees: [dirs.main, dirs.linked], branches: ['main', 'notes'] }, folder)
  }
})

test('a verifier whose worktree Claude Code already removed: its branch is deleted', () => {
  // Its worktree is gone, so the hook's cwd cannot be it: here it is the main checkout, or the
  // user's linked worktree.
  for (const at of ['main', 'linked']) {
    const dirs = repo()
    // As Claude Code removes it: unlock, then remove, which leaves the branch.
    git(dirs.main, 'worktree', 'unlock', dirs.worktree)
    git(dirs.main, 'worktree', 'remove', dirs.worktree)
    assert.deepEqual(state(dirs.main).branches, ['main', 'notes', BRANCH])
    const r = hook(dirs.tmp, dirs[at])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', at)
    assert.deepEqual(state(dirs.main), { worktrees: [dirs.main, dirs.linked], branches: ['main', 'notes'] }, at)
  }
})

test('a verifier whose branch holds a commit on no remote branch: the branch is kept, and the output says so', () => {
  const { tmp, main, linked, worktree } = repo()
  // A commit on the verifier's branch that was never pushed; the worktree stays detached.
  writeFileSync(join(worktree, 'local.txt'), 'never pushed\n')
  git(worktree, 'add', 'local.txt')
  git(worktree, 'commit', '-qm', 'Never pushed')
  git(worktree, 'branch', '-f', BRANCH)
  const commit = git(main, 'rev-parse', BRANCH)
  const r = hook(tmp, worktree)
  assert.equal(r.status, 0, r.stderr)
  // Only a systemMessage: additionalContext or a block would keep the verifier going.
  assert.deepEqual(Object.keys(r.out), ['systemMessage'])
  assert.match(r.out.systemMessage, new RegExp(`kept the verifier's branch ${BRANCH}, since it holds ${commit}, a commit that is on no remote branch`))
  assert.deepEqual(state(main), { worktrees: [main, linked], branches: ['main', 'notes', BRANCH] })
  assert.equal(git(main, 'rev-parse', BRANCH), commit)
})

test('the stop of an agent of any other type: no output, and its locked worktree and branch are left alone', () => {
  const { tmp, main, linked, worktree } = repo()
  const before = state(main)
  assert.deepEqual(before, { worktrees: [main, linked, `${worktree} (locked)`], branches: ['main', 'notes', BRANCH] })
  // hooks.json's matcher is a regex, so it also lets through a type that only contains the verifier's.
  for (const type of ['general-purpose', 'Explore', 'macro-loop:verifier-lite']) {
    const r = hook(tmp, worktree, { agent_type: type })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
    assert.deepEqual(state(main), before, type)
  }
})

test('an agent_id that is not a plain id: refused, before any path or branch is made from it', () => {
  const { tmp, main, worktree } = repo()
  const before = state(main)
  // The first one would name the user's linked worktree: .claude/worktrees/agent-<id>/../../../../linked.
  for (const id of [`${ID}/../../../../linked`, `${ID} --force`, '', undefined]) {
    const r = hook(tmp, worktree, { agent_id: id })
    assert.equal(r.status, 1, JSON.stringify(id))
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /is not a plain id of letters and digits/)
    assert.deepEqual(state(main), before)
  }
})
