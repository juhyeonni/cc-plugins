#!/usr/bin/env node
// The plugin's PreToolUse hook on the Bash tool (#33), from hooks/hooks.json. A verifier runs
// only in its own worktree, `.claude/worktrees/agent-<agent_id>`. Claude Code gives it that
// worktree when it starts and removes it when it ends without changes, so a verifier continued
// with SendMessage runs in the session's working directory, and Claude Code does not stop it.
// This refuses any command a verifier would run outside its own worktree. Every other call,
// from the main session or any other agent, passes through with no output.
//
// A verifier that a workflow starts (`execute`, #111) gets the worktree the workflow made,
// `.claude/worktrees/wf_<run>-<n>`, which is not named after the agent, so that name counts too.
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const WORKFLOW = /^wf_[\w-]+-\d+$/

if (input.agent_type === 'macro-loop:verifier') {
  const parts = String(input.cwd ?? '').split(/[\\/]/)
  const named = (name) => (input.agent_id && name === `agent-${input.agent_id}`) || WORKFLOW.test(name ?? '')
  const own = parts.some((p, i) => p === '.claude' && parts[i + 1] === 'worktrees' && named(parts[i + 2]))
  if (!own) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `macro-loop: a verifier runs commands only in its own worktree, .claude/worktrees/agent-${input.agent_id}, and this one would run in ${input.cwd}. A worktree a workflow made, .claude/worktrees/wf_<run>-<n>, counts as its own too. Run nothing more: end your report by saying you are not in your worktree, so verify stops the run as INCONCLUSIVE.`,
        },
      }),
    )
  }
}
