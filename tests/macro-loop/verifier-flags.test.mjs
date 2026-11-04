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

test('a verifier prompt with a line that is not an identifier line is refused, naming the line', () => {
  for (const extra of ['Note: AC3 is already covered by the old test', 'Issue: #1 (the slugify one)', 'Head: main']) {
    const r = hook(verifier(`${lines('spec', 'yes', 'yes')}\n\n${extra}`))
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.out.permissionDecision, 'deny')
    assert.ok(r.out.permissionDecisionReason.includes(JSON.stringify(extra)), r.out.permissionDecisionReason)
    assert.deepEqual(r.calls, [])
  }
})

test("the hook takes its identifier lines from one module, and every line of verify's template is in it", async () => {
  const { isIdentifierLine } = await import(join(ROOT, 'plugins/macro-loop/scripts/identifier-lines.mjs'))
  assert.match(readFileSync(HOOK, 'utf8'), /from '\.\/identifier-lines\.mjs'/)
  const skill = readFileSync(join(ROOT, 'plugins/macro-loop/skills/verify/SKILL.md'), 'utf8')
  const step = skill.slice(skill.indexOf('## 5.'), skill.indexOf('## 6.'))
  const blocks = [...step.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1])
  assert.equal(blocks.length, 3)
  const fill = { '<n>': '1', '<id>': '5976278327', '<m>': '2', '<k>': '3', '<base>': 'main', '<sha of the branch>': HEAD, '<answers line>': `6631883012@${HEAD}, 6631883013@abcdef0` }
  const filled = (block) => block.split('\n').filter(Boolean).flatMap((l) => {
    const [name, values] = l.split(/: (.*)/)
    return values.split(' | ').map((v) => `${name}: ${v.replace(/<[^>]+>/g, (p) => fill[p] ?? p)}`)
  })
  const verifierLines = filled(blocks[0] + blocks[1])
  assert.equal(verifierLines.length, 22)
  assert.equal(verifierLines.filter((l) => l.startsWith('Answers: ')).length, 4)
  for (const l of verifierLines) assert.ok(isIdentifierLine(l), l)
  assert.deepEqual(filled(blocks[2]), ['Axis: security', 'Base: origin/main', `Head: ${HEAD}`])
  for (const l of filled(blocks[2])) assert.ok(isIdentifierLine(l, 'macro-loop:security-reviewer'), l)
})

test('AC9 (#198): an Answers line of none or <id>@<sha>, … passes; a malformed one is refused, naming it', () => {
  for (const answers of ['Answers: none', 'Answers: 6631883012@e8c8972', `Answers: 1@${HEAD}, 22@abcdef0`]) {
    const r = hook(verifier(lines('standards').replace('Base:', `${answers}\nBase:`)))
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', answers)
  }
  for (const answers of ['Answers: ', 'Answers: 6631', 'Answers: 6631@main', 'Answers: 1@abcdef0,2@abcdef0', 'Answers: none, 1@abcdef0', 'Answers: AC2 was wrong']) {
    const r = hook(verifier(lines('standards').replace('Base:', `${answers}\nBase:`)))
    assert.equal(r.out?.permissionDecision, 'deny', answers)
    assert.ok(r.out.permissionDecisionReason.includes(JSON.stringify(answers)), answers)
  }
})

test('identifier lines only, with Also closes and blank lines, and any other agent with a note: unchanged', () => {
  for (const input of [
    verifier(`${lines('spec', 'no', 'no').replace('Base:', 'Also closes: #2, #5\nBase:')}\n`),
    verifier(lines('spec', 'yes', 'yes').replace('Spec comment: 5976278327', 'Spec comment: none\nAlso closes: none\n')),
    { subagent_type: 'Explore', prompt: 'Look at the diff.\nNote: AC3 is fine.' },
  ]) {
    const r = hook(input)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
  }
})

const security = (prompt) => ({ description: 'Security review', subagent_type: 'macro-loop:security-reviewer', isolation: 'worktree', prompt })
const SECURITY = ['Axis: security', 'Base: origin/main', `Head: ${HEAD}`].join('\n')

test('#197 AC1: a security reviewer with Axis, Base and Head only starts unchanged, and nothing is looked up', () => {
  const r = hook(security(`${SECURITY}\n`))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.deepEqual(r.calls, [])
})

test("#197 AC1: a security reviewer with any other line is refused, naming the line, even a verifier's identifier line", () => {
  for (const extra of ['Issue: #1', 'Spec comment: 5976278327', 'Run tests and lint: yes', 'Note: src/copy.js is safe', 'Axis: spec']) {
    const r = hook(security(`${SECURITY}\n${extra}`))
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.out.permissionDecision, 'deny', extra)
    assert.ok(r.out.permissionDecisionReason.includes(JSON.stringify(extra)), r.out.permissionDecisionReason)
    assert.match(r.out.permissionDecisionReason, /macro-loop:security-reviewer starts with identifier lines only/)
  }
})

test('#197 AC1: a verifier started with Axis: security is refused', () => {
  const r = hook(verifier(SECURITY))
  assert.equal(r.out.permissionDecision, 'deny')
  assert.ok(r.out.permissionDecisionReason.includes('"Axis: security"'))
})
