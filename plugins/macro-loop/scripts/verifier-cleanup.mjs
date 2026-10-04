#!/usr/bin/env node
// The plugin's PostToolUse hook on the Agent tool (#31), from hooks/hooks.json. Claude Code
// gives a verifier a worktree, `.claude/worktrees/agent-<agentId>` under the main checkout, on
// a branch, `worktree-agent-<agentId>`. When the verifier ends, Claude Code keeps the worktree
// if it changed, and keeps the branch when the worktree ended on a detached HEAD, as a
// verifier's does: it checks out the PR's head. So after each macro-loop:verifier, this
// removes the worktree if it is still there and deletes the branch, unless the branch holds a
// commit that is on no remote branch: that branch is kept, and the hook says so. Every other
// Agent call passes through with no output. A git error stops it, with the reason on stderr.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))
const { agentType, agentId } = input.tool_response ?? {}

function git(args) {
  const r = spawnSync('git', args, { cwd: input.cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout.trim()
}

if (agentType === 'macro-loop:verifier') {
  try {
    // The id becomes a path and a branch name, so only letters and digits are taken.
    if (!/^[A-Za-z0-9]+$/.test(agentId ?? '')) throw new Error(`the verifier's agentId, ${JSON.stringify(agentId)}, is not a plain id of letters and digits`)
    // The worktree is under the main checkout also when the session runs in a linked worktree,
    // and the repo's common git dir is that checkout's .git. The path is compared as git
    // prints paths, with `/` on every platform.
    const main = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']))
    const worktree = `${main}/.claude/worktrees/agent-${agentId}`
    const branch = `worktree-agent-${agentId}`
    if (git(['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${worktree}`)) git(['worktree', 'remove', '--force', worktree])
    if (git(['branch', '--list', branch]) !== '') {
      const unpushed = git(['rev-list', '-n', '1', `refs/heads/${branch}`, '--not', '--remotes'])
      if (unpushed === '') {
        git(['branch', '-D', branch])
      } else {
        const kept = `macro-loop: kept the verifier's branch ${branch}, since it holds ${unpushed}, a commit that is on no remote branch. Tell the user.`
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: kept } }))
      }
    }
  } catch (e) {
    process.stderr.write(`verifier-cleanup.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
