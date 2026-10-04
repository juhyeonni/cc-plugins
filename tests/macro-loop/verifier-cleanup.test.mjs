import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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

// A checkout of a bare `origin` with `main` pushed; the user's linked worktree on `notes`;
// and a verifier's worktree as Claude Code makes it, from origin/main on worktree-agent-<id>,
// then detached, as the verifier's checkout of the PR's head leaves it.
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
  return { tmp, main, linked, worktree }
}

// The worktrees git has registered, and the local branches.
const state = (main) => ({
  worktrees: git(main, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length)),
  branches: git(main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n'),
})

// Runs the hook as Claude Code would: the PostToolUse input for an Agent call on stdin, by
// default a verifier that ended. It runs in a folder outside the repo, so only the input's cwd
// can lead it there.
function hook(tmp, cwd, { type = 'macro-loop:verifier', ...response } = {}) {
  const input = {
    session_id: 's',
    cwd,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: type, description: 'Spec verifier', prompt: 'Axis: spec' },
    tool_response: { status: 'completed', agentId: ID, agentType: type, content: [{ type: 'text', text: 'report' }], ...response },
  }
  const r = spawnSync(process.execPath, [HOOK], { cwd: tmp, input: JSON.stringify(input), encoding: 'utf8' })
  return { ...r, out: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null }
}

test('a verifier whose worktree is still there: the worktree is removed and its branch deleted, from the main checkout or a linked worktree', () => {
  for (const at of ['main', 'linked']) {
    const dirs = repo()
    // Files changed in it, which is why Claude Code kept it.
    writeFileSync(join(dirs.worktree, 'README.md'), '# demo\nchanged by a check\n')
    writeFileSync(join(dirs.worktree, 'out.txt'), 'left by a check\n')
    const r = hook(dirs.tmp, dirs[at])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', at)
    assert.equal(existsSync(dirs.worktree), false, at)
    assert.deepEqual(state(dirs.main), { worktrees: [dirs.main, dirs.linked], branches: ['main', 'notes'] }, at)
  }
})

test('a verifier whose worktree Claude Code already removed: its branch is deleted', () => {
  const { tmp, main, linked, worktree } = repo()
  git(main, 'worktree', 'remove', worktree)
  assert.deepEqual(state(main).branches, ['main', 'notes', BRANCH])
  const r = hook(tmp, main)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.deepEqual(state(main), { worktrees: [main, linked], branches: ['main', 'notes'] })
})

test('a verifier whose branch holds a commit on no remote branch: the branch is kept, and the output says so', () => {
  const { tmp, main, linked, worktree } = repo()
  // A commit on the verifier's branch that was never pushed; the worktree stays detached.
  writeFileSync(join(worktree, 'local.txt'), 'never pushed\n')
  git(worktree, 'add', 'local.txt')
  git(worktree, 'commit', '-qm', 'Never pushed')
  git(worktree, 'branch', '-f', BRANCH)
  const commit = git(main, 'rev-parse', BRANCH)
  const r = hook(tmp, main)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.hookEventName, 'PostToolUse')
  assert.match(r.out.additionalContext, new RegExp(`kept the verifier's branch ${BRANCH}, since it holds ${commit}, a commit that is on no remote branch`))
  assert.deepEqual(state(main), { worktrees: [main, linked], branches: ['main', 'notes', BRANCH] })
  assert.equal(git(main, 'rev-parse', BRANCH), commit)
})

test('an Agent call of any other type: no output, and no worktree or branch changes', () => {
  const { tmp, main, linked, worktree } = repo()
  const before = state(main)
  assert.deepEqual(before, { worktrees: [main, linked, worktree], branches: ['main', 'notes', BRANCH] })
  // A verifier started in the background returns while it still runs, with no agentType.
  for (const response of [{ type: 'general-purpose' }, { type: 'Explore' }, { status: 'async_launched', agentType: undefined }]) {
    const r = hook(tmp, main, response)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
    assert.deepEqual(state(main), before, JSON.stringify(response))
  }
})

test('an agentId that is not a plain id: refused, before any path or branch is made from it', () => {
  const { tmp, main } = repo()
  const before = state(main)
  // The first one would name the user's linked worktree: .claude/worktrees/agent-<id>/../../../../linked.
  for (const agentId of [`${ID}/../../../../linked`, `${ID} --force`, '', undefined]) {
    const r = hook(tmp, main, { agentId })
    assert.equal(r.status, 1, JSON.stringify(agentId))
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /is not a plain id of letters and digits/)
    assert.deepEqual(state(main), before)
  }
})
