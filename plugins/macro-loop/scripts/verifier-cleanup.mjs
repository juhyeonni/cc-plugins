#!/usr/bin/env node
// The plugin's SubagentStop hook for macro-loop:verifier (#31), from hooks/hooks.json. Claude
// Code gives a verifier a worktree, `.claude/worktrees/agent-<agent_id>` under the main
// checkout, on a branch, `worktree-agent-<agent_id>`, and can leave both behind: a verifier
// checks out the PR's head, detached, and Claude Code keeps the branch of a worktree that ends
// detached. So when a verifier stops, in the foreground or the background, this removes its
// worktree, which Claude Code still holds locked then, and deletes its branch, unless the
// branch holds a commit that is on no remote branch: that branch is kept, and the hook says
// so. Any other agent's stop passes through with no output. A git error stops it, with the
// reason on stderr.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout.trim()
}

if (input.agent_type === 'macro-loop:verifier') {
  try {
    const id = input.agent_id
    // The id becomes a path and a branch name, so only letters and digits are taken.
    if (!/^[A-Za-z0-9]+$/.test(id ?? '')) throw new Error(`the verifier's agent_id, ${JSON.stringify(id)}, is not a plain id of letters and digits`)
    // The hook's cwd is the verifier's worktree, which goes, so git runs from the main checkout:
    // the parent of the repo's common git dir, also when the session runs in a linked worktree.
    // The path is compared as git prints paths, with `/` on every platform.
    const main = dirname(git(input.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
    const worktree = `${main}/.claude/worktrees/agent-${id}`
    const branch = `worktree-agent-${id}`
    // A second --force removes a locked worktree.
    if (git(main, ['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${worktree}`)) git(main, ['worktree', 'remove', '--force', '--force', worktree])
    if (git(main, ['branch', '--list', branch]) !== '') {
      const unpushed = git(main, ['rev-list', '-n', '1', `refs/heads/${branch}`, '--not', '--remotes'])
      if (unpushed === '') {
        git(main, ['branch', '-D', branch])
      } else {
        // A systemMessage goes to the user; additionalContext would go to the verifier and
        // keep it going.
        const kept = `macro-loop: kept the verifier's branch ${branch}, since it holds ${unpushed}, a commit that is on no remote branch.`
        process.stdout.write(JSON.stringify({ systemMessage: kept }))
      }
    }
  } catch (e) {
    process.stderr.write(`verifier-cleanup.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
