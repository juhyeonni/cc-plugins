import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HOOK = join(ROOT, 'plugins/macro-loop/scripts/verifier-flags.mjs')
const HEAD = 'e8c89722a5abdff1a856f819e8a29805bb426896'

// The same stand-in for `gh` as trust.test.mjs: a table of answers, a log of calls.
const STUB = `#!/usr/bin/env node
const fs = require('fs')
const key = process.argv.slice(2).join(' ')
fs.appendFileSync(process.env.GH_LOG, key + '\\n')
const r = JSON.parse(fs.readFileSync(process.env.GH_STUB, 'utf8'))[key]
if (!r) { process.stderr.write('stub: unexpected call: gh ' + key + '\\n'); process.exit(99) }
if (r.stdout !== undefined) process.stdout.write(typeof r.stdout === 'string' ? r.stdout : JSON.stringify(r.stdout))
if (r.stderr) process.stderr.write(r.stderr)
process.exit(r.code ?? 0)
`

// Runs the hook as Claude Code would: the PreToolUse input on stdin, in the repo's checkout.
function hook(toolInput, responses = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'hook-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  writeFileSync(join(tmp, 'stub.json'), JSON.stringify(responses))
  const cwd = join(tmp, 'checkout')
  mkdirSync(cwd)
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}`, GH_STUB: join(tmp, 'stub.json'), GH_LOG: join(tmp, 'calls.log') }
  writeFileSync(env.GH_LOG, '')
  const input = { session_id: 's', cwd, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: toolInput }
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8' })
  return { ...r, calls: readFileSync(env.GH_LOG, 'utf8').split('\n').filter(Boolean), out: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null }
}

const lines = (axis, spec, tests) =>
  [`Axis: ${axis}`, 'Issue: #1', 'Spec comment: 5976278327', 'Base: origin/main', `Head: ${HEAD}`, ...(axis === 'spec' ? [`Run spec commands: ${spec}`, `Run tests and lint: ${tests}`] : [])].join('\n')
const verifier = (prompt) => ({ description: 'Spec verifier', subagent_type: 'macro-loop:verifier', isolation: 'worktree', prompt })

const contents = (config) => ({ stdout: { content: Buffer.from(JSON.stringify(config)).toString('base64'), encoding: 'base64' } })
// The repo belongs to the User juhyeonni; PR #3, at HEAD, is by `author`.
const github = (author) => ({
  [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`]: { stdout: [{ number: 3, state: 'open', head: { sha: HEAD } }, { number: 2, state: 'closed', head: { sha: 'f'.repeat(40) } }] },
  'api user': { stdout: { login: 'juhyeonni' } },
  'api repos/{owner}/{repo}': { stdout: { owner: { login: 'juhyeonni', type: 'User' } } },
  'api repos/{owner}/{repo}/contents/.github/macro-loop.json': contents({ trusted: [] }),
  'api repos/{owner}/{repo}/pulls/3': { stdout: { user: { login: author }, head: { sha: HEAD }, base: { ref: 'main' }, body: 'Closes #1' } },
  'api --paginate --slurp repos/{owner}/{repo}/issues/3/comments': { stdout: [[]] },
  'api --paginate --slurp repos/{owner}/{repo}/issues/1/comments': { stdout: [[]] },
})

test('another agent, the standards axis, or equal lines: unchanged, and nothing is looked up', () => {
  for (const input of [
    { subagent_type: 'Explore', prompt: 'Run spec commands: yes\nRun tests and lint: no' },
    verifier(lines('standards')),
    verifier(lines('spec', 'yes', 'yes')),
    verifier(lines('spec', 'no', 'no')),
  ]) {
    const r = hook(input)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.deepEqual(r.calls, [])
  }
})

test('differing lines for an untrusted author: both become no, the rest of the call is kept', () => {
  const input = verifier(lines('spec', 'yes', 'no'))
  const r = hook(input, github('anpanmanni'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.permissionDecision, 'allow')
  assert.deepEqual(r.out.updatedInput, { ...input, prompt: lines('spec', 'no', 'no') })
  assert.match(r.out.additionalContext, /not trusted/)
})

test('differing lines for a trusted author: unchanged', () => {
  const r = hook(verifier(lines('spec', 'no', 'yes')), github('JuHyeonni'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
})

test('differing lines with no open PR at the head: unchanged', () => {
  const r = hook(verifier(lines('spec', 'yes', 'no')), { [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`]: { stdout: [] } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
})

test('a failed lookup refuses to start the verifier', () => {
  const r = hook(verifier(lines('spec', 'yes', 'no')), { [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`]: { stderr: 'gh: Server Error (HTTP 500)\n', code: 1 } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.permissionDecision, 'deny')
  assert.match(r.out.permissionDecisionReason, /HTTP 500/)
})

test('a head GitHub does not have counts as no open PR: unchanged, and trust is not checked', () => {
  const r = hook(verifier(lines('spec', 'no', 'yes')), {
    [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`]: { stderr: `gh: No commit found for SHA: ${HEAD} (HTTP 422)\n`, code: 1 },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.deepEqual(r.calls, [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`])
})

test('a 422 with another message still refuses to start the verifier', () => {
  const r = hook(verifier(lines('spec', 'no', 'yes')), {
    [`api repos/{owner}/{repo}/commits/${HEAD}/pulls`]: { stderr: 'gh: Validation Failed (HTTP 422)\n', code: 1 },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.permissionDecision, 'deny')
  assert.match(r.out.permissionDecisionReason, /HTTP 422/)
})
