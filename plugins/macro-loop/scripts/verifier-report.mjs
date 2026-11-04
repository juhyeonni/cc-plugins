#!/usr/bin/env node
// The plugin's hook that saves a macro-loop:verifier's or the security reviewer's report (#176,
// #203, #197), from hooks/hooks.json, so the report reaches verdict.mjs (`--agent <id>`) without
// the verify session copying it. It writes `<agent_id>.md` in the reports directory from one of two events:
// - PostToolUse on SubagentHandback: a background verifier hands its report back as the call's
//   `tool_input.message`.
// - SubagentStop: the stop's `last_assistant_message`, unless a hand-back already saved the
//   report; after a hand-back that field holds only the closing text, or nothing.
// An event without its report saves nothing and is named on stderr: verdict.mjs then finds no
// report and posts nothing. Any other agent's event passes through with no output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REVIEWERS } from './identifier-lines.mjs'

// Under the user's home, not the system temp folder: on Linux that is /tmp, shared by every
// user, and verdict.mjs trusts what it finds here.
export const reportsDir = () => process.env.MACRO_LOOP_REPORTS ?? join(homedir(), '.claude', 'macro-loop-reports')

// The id becomes a file name, so only letters and digits are taken.
export function reportPath(id) {
  if (!/^[A-Za-z0-9]+$/.test(id ?? '')) throw new Error(`the verifier's agent id, ${JSON.stringify(id)}, is not a plain id of letters and digits`)
  return join(reportsDir(), `${id}.md`)
}

// The report this event carries, or null when a hand-back already saved it.
function report(input, path) {
  if (input.hook_event_name === 'PostToolUse') {
    if (!input.tool_input?.message) throw new Error(`verifier ${input.agent_id} handed back no message`)
    return input.tool_input.message
  }
  if (existsSync(path)) return null
  if (!input.last_assistant_message) throw new Error(`verifier ${input.agent_id} stopped without last_assistant_message`)
  return input.last_assistant_message
}

function save(input) {
  if (!REVIEWERS.includes(input.agent_type)) return
  const path = reportPath(input.agent_id)
  const text = report(input, path)
  if (text === null) return
  mkdirSync(reportsDir(), { recursive: true, mode: 0o700 })
  writeFileSync(path, text)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    save(JSON.parse(readFileSync(0, 'utf8')))
  } catch (e) {
    process.stderr.write(`verifier-report.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
