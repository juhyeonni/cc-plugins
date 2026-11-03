#!/usr/bin/env node
// The plugin's SubagentStop hook that saves a macro-loop:verifier's report (#176), from
// hooks/hooks.json, so the report reaches verdict.mjs (`--agent <id>`) without the verify
// session copying it. It saves the stop's `last_assistant_message` as `<agent_id>.md` in the
// reports directory; without that field, the last assistant text in `agent_transcript_path`,
// which can lag when the hook fires. Any other agent's stop passes through with no output.
// A failure is named on stderr; verdict.mjs then finds no report and posts nothing.
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

function lastText(transcript) {
  const lines = readFileSync(transcript, 'utf8').split('\n').filter((l) => l.trim() !== '').reverse()
  for (const line of lines) {
    const e = JSON.parse(line)
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    const text = e.message.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
    if (text.trim() !== '') return text
  }
  return null
}

function save(input) {
  if (input.agent_type !== 'macro-loop:verifier') return
  const path = reportPath(input.agent_id)
  const text = input.last_assistant_message || (input.agent_transcript_path && lastText(input.agent_transcript_path))
  if (!text) throw new Error(`verifier ${input.agent_id} stopped with no report`)
  mkdirSync(reportsDir(), { recursive: true })
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
