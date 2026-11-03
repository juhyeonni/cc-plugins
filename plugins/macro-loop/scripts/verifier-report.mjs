#!/usr/bin/env node
// The plugin's SubagentStop hook that saves a macro-loop:verifier's report (#176), from
// hooks/hooks.json, so the report reaches verdict.mjs (`--agent <id>`) without the verify
// session copying it. It saves the stop's `last_assistant_message` as `<agent_id>.md` in the
// reports directory. A stop without that field saves nothing and is named on stderr:
// verdict.mjs then finds no report and posts nothing. Any other agent's stop passes through
// with no output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const reportsDir = () => process.env.MACRO_LOOP_REPORTS ?? join(tmpdir(), 'macro-loop-reports')

// The id becomes a file name, so only letters and digits are taken.
export function reportPath(id) {
  if (!/^[A-Za-z0-9]+$/.test(id ?? '')) throw new Error(`the verifier's agent id, ${JSON.stringify(id)}, is not a plain id of letters and digits`)
  return join(reportsDir(), `${id}.md`)
}

function save(input) {
  if (input.agent_type !== 'macro-loop:verifier') return
  const path = reportPath(input.agent_id)
  if (!input.last_assistant_message) throw new Error(`verifier ${input.agent_id} stopped without last_assistant_message`)
  mkdirSync(reportsDir(), { recursive: true })
  writeFileSync(path, input.last_assistant_message)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    save(JSON.parse(readFileSync(0, 'utf8')))
  } catch (e) {
    process.stderr.write(`verifier-report.mjs: ${e.message}\n`)
    process.exitCode = 1
  }
}
