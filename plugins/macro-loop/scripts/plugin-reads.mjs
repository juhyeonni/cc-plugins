#!/usr/bin/env node
// The plugin's second PreToolUse hook on the Bash tool (#336), from hooks/hooks.json. A Bash call
// that reads or lists the plugin's own files (`cat`, `ls`, `grep` ... of a path under
// CLAUDE_PLUGIN_ROOT) is denied with a reason that sends the session to the Read or Glob tool, so
// no run waits on a permission prompt for it. A deny from a hook asks no person.
// Running a plugin script (`node <root>/scripts/<name>.mjs`), every other command, and input the
// hook cannot parse pass through with no output.
import { readFileSync } from 'node:fs'
import { isMain } from './is-main.mjs'

export const REASON = "Read the plugin's files with the Read tool, one per call; list them with Glob"
const READERS = new Set(['cat', 'head', 'tail', 'less', 'ls', 'find', 'sed', 'grep', 'wc'])

// Whether `command` runs a reader on a path under `root`, in any of its chained or piped parts.
export function readsPlugin(command, root) {
  if (typeof command !== 'string' || !root) return false
  const base = root.replace(/[\\/]+$/, '')
  const roots = [base, '$CLAUDE_PLUGIN_ROOT', '${CLAUDE_PLUGIN_ROOT}']
  const underRoot = (word) => roots.some((r) => word === r || word.startsWith(`${r}/`))
  return command.split(/&&|\|\||[;|\n]/).some((part) => {
    const words = part.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, ''))
    return READERS.has(words[0]) && words.slice(1).some(underRoot)
  })
}

if (isMain(import.meta.url)) {
  let input = null
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {}
  if (readsPlugin(input?.tool_input?.command, process.env.CLAUDE_PLUGIN_ROOT)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON },
      }),
    )
  }
}
