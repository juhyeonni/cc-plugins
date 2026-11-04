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

function run(input, reports) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, MACRO_LOOP_REPORTS: reports } })
  return { ...r, reports }
}

// Runs the hook as Claude Code does when a verifier calls SubagentHandback (PostToolUse).
function handback(fields = {}, reports = join(mkdtempSync(join(tmpdir(), 'report-')), 'reports')) {
  return run({
    session_id: 's',
    cwd: reports,
    hook_event_name: 'PostToolUse',
    agent_id: ID,
    agent_type: 'macro-loop:verifier',
    tool_name: 'SubagentHandback',
    tool_input: { message: 'the handed-back report' },
    tool_response: {},
    ...fields,
  }, reports)
}

// Runs the hook as Claude Code does when an agent stops, with its reports directory in a temp folder.
function hook(fields = {}, reports) {
  const tmp = mkdtempSync(join(tmpdir(), 'report-'))
  reports ??= join(tmp, 'reports')
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
  return { ...run(input, reports), tmp }
}

test("a verifier's SubagentHandback saves its message as <agent_id>.md", () => {
  const r = handback()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.equal(readFileSync(join(r.reports, `${ID}.md`), 'utf8'), 'the handed-back report')
})

test("the plugin's hooks send SubagentHandback calls to this script", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'plugins/macro-loop/hooks/hooks.json'), 'utf8')).hooks
  const group = hooks.PostToolUse.find((g) => new RegExp(`^(${g.matcher})$`).test('SubagentHandback'))
  assert.ok(group, 'no PostToolUse group matches SubagentHandback')
  assert.ok(group.hooks.some((h) => h.args.some((a) => a.endsWith('/scripts/verifier-report.mjs'))))
})

test("another agent's SubagentHandback saves nothing and prints nothing", () => {
  const r = handback({ agent_type: 'Explore' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout + r.stderr, '')
  assert.equal(existsSync(r.reports), false)
})

for (const [name, fields] of [['closing text', { last_assistant_message: 'Report handed back.' }], ['no message', { last_assistant_message: undefined }]]) {
  test(`after a hand-back, the verifier's stop with ${name} leaves the saved report as it is`, () => {
    const first = handback()
    const r = hook(fields, first.reports)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(readFileSync(join(r.reports, `${ID}.md`), 'utf8'), 'the handed-back report')
  })
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

test("#197 AC2: the security reviewer's stop saves its last message as <agent_id>.md", () => {
  const r = hook({ agent_type: 'macro-loop:security-reviewer', last_assistant_message: 'the security report' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(r.reports, `${ID}.md`), 'utf8'), 'the security report')
})

test("#197: the security reviewer's SubagentHandback saves its message, and its later stop leaves it as it is", () => {
  const first = handback({ agent_type: 'macro-loop:security-reviewer', tool_input: { message: 'the security report' } })
  assert.equal(first.status, 0, first.stderr)
  const stop = hook({ agent_type: 'macro-loop:security-reviewer', last_assistant_message: 'Report handed back.' }, first.reports)
  assert.equal(stop.status, 0, stop.stderr)
  assert.equal(readFileSync(join(first.reports, `${ID}.md`), 'utf8'), 'the security report')
})

test('#197: the security reviewer waits for its sub-tasks and never ends without a block', () => {
  const text = readFileSync(join(ROOT, 'plugins/macro-loop/agents/security-reviewer.md'), 'utf8')
  assert.match(text, /Agent tool and `run_in_background: false`, and do not end your turn until every sub-task has returned/)
  assert.match(text, /do not end your turn saying you wait: write the block with `couldNotRun`/)
})
