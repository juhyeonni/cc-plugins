import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HOOK = join(ROOT, 'plugins/macro-loop/scripts/verifier-worktree.mjs')
const REPO = '/work/repo'
const ID = 'a2bd9f539d77638a8'
const OWN = `${REPO}/.claude/worktrees/agent-${ID}`

// Runs the hook as Claude Code would: the PreToolUse input for a Bash call on stdin.
function hook(fields) {
  const input = { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, ...fields }
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8' })
  return { ...r, out: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null }
}

const verifier = (cwd) => hook({ agent_type: 'macro-loop:verifier', agent_id: ID, cwd })

test('the main session and other agents: no output, wherever they run', () => {
  for (const fields of [{ cwd: REPO }, { agent_type: 'Explore', agent_id: 'a1', cwd: REPO }, { agent_type: 'general-purpose', agent_id: 'a1', cwd: '/work/user-wt' }]) {
    const r = hook(fields)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
  }
})

test("a verifier in its own worktree, or a folder in it: no output", () => {
  for (const cwd of [OWN, `${OWN}/`, `${OWN}/src`, `C:\\work\\repo\\.claude\\worktrees\\agent-${ID}`]) {
    const r = verifier(cwd)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', cwd)
  }
})

test('a verifier anywhere else: refused, with the reason', () => {
  for (const cwd of [
    REPO, // the main checkout, where a continued verifier runs
    '/work/user-wt', // a linked worktree the session started in, as in #33
    `${REPO}/.claude/worktrees/agent-b0b0b0b0b0b0b0b0b`, // another agent's worktree
    `${REPO}/.claude/worktrees/feature-x`, // a --worktree session's worktree
    `${REPO}/.claude/worktrees/agent-${ID}x`, // a name that only starts with its own
  ]) {
    const r = verifier(cwd)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.out.permissionDecision, 'deny', cwd)
    assert.match(r.out.permissionDecisionReason, new RegExp(`agent-${ID}, and this one would run in ${cwd.replace(/[.\\]/g, '\\$&')}\\.`))
  }
})

test("AC13 (#111): a verifier in a workflow's worktree, or a folder in it: no output", () => {
  for (const cwd of [`${REPO}/.claude/worktrees/wf_5e3d60a4-4af-1`, `${REPO}/.claude/worktrees/wf_5e3d60a4-4af-12/src`, 'C:\\work\\repo\\.claude\\worktrees\\wf_f315867a-1bb-2']) {
    const r = verifier(cwd)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', cwd)
  }
})

test("AC13 (#111): names that only look like a workflow's worktree are refused", () => {
  for (const cwd of [`${REPO}/.claude/worktrees/wf_`, `${REPO}/.claude/worktrees/wf_5e3d60a4-4af`, `${REPO}/wf_5e3d60a4-4af-1`, `${REPO}/.claude/wf_5e3d60a4-4af-1`]) {
    assert.equal(verifier(cwd).out?.permissionDecision, 'deny', cwd)
  }
})

test('a verifier with no agent_id or no cwd: refused', () => {
  for (const fields of [{ agent_type: 'macro-loop:verifier', cwd: OWN }, { agent_type: 'macro-loop:verifier', agent_id: ID }]) {
    const r = hook(fields)
    assert.equal(r.out.permissionDecision, 'deny')
  }
})
