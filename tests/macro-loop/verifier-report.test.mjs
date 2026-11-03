import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HOOK = join(ROOT, 'plugins/macro-loop/scripts/verifier-report.mjs')
const ID = 'a88ecdfd82743e9f2'

// Runs the hook as Claude Code does when an agent stops, with its reports directory in a temp folder.
function hook(fields = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'report-'))
  const reports = join(tmp, 'reports')
  const input = {
    session_id: 's',
    cwd: tmp,
    hook_event_name: 'SubagentStop',
    agent_id: ID,
    agent_type: 'macro-loop:verifier',
    agent_transcript_path: join(tmp, `agent-${ID}.jsonl`),
    last_assistant_message: 'the report',
    ...fields,
  }
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, MACRO_LOOP_REPORTS: reports } })
  return { ...r, reports, tmp }
}

test("a verifier's stop saves its last message as <agent_id>.md", () => {
  const r = hook()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.equal(readFileSync(join(r.reports, `${ID}.md`), 'utf8'), 'the report')
})

test('without last_assistant_message, nothing is saved and the stop is named, even with a transcript holding text', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'transcript-'))
  const transcript = join(tmp, 'agent.jsonl')
  writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a stale report' }] } })}\n`)
  const r = hook({ last_assistant_message: undefined, agent_transcript_path: transcript })
  assert.equal(r.status, 1)
  assert.match(r.stderr, new RegExp(`verifier ${ID} stopped without last_assistant_message`))
  assert.equal(existsSync(join(r.reports, `${ID}.md`)), false)
})

test("another agent's stop saves nothing and prints nothing", () => {
  const r = hook({ agent_type: 'Explore' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout + r.stderr, '')
  assert.equal(existsSync(r.reports) && readdirSync(r.reports).length, false)
})

test('an agent id that is not plain letters and digits saves nothing and is named', () => {
  const r = hook({ agent_id: '../x' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /"\.\.\/x"/)
  assert.equal(existsSync(r.reports), false)
})
