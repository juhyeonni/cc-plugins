import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, goalGaps } from './checks.mjs'
import { asksSomething, assertRunnable, assertSandbox, blockPushes, claudeArgs, hashTree, pickAnswer, play, pluginCommit, githubSnapshot, githubState, removeCanaries, resetGoalSandbox, restoreGithub, runMutants, seedMessage, sh } from './run.mjs'
import { GOAL_SANDBOX, MUTANT_OPERATORS, SPEC_1_CRITERIA, findScenario, mutants, rescoreSet, scenarios } from './scenarios.mjs'
import { findProjectDir, loadCalls, loadUsage, usageOf } from './transcript.mjs'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs')
const IDS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'D1', 'E1', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']

// Only node on the PATH: a dry run that tried to start `claude` or `gh` would fail.
const nodeOnly = (args) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', env: { PATH: dirname(process.execPath) } })

test('the suite defines the first batch', () => {
  assert.deepEqual(scenarios.map((s) => s.id), IDS)
  const listed = nodeOnly(['--list'])
  assert.equal(listed.status, 0)
  for (const id of IDS) assert.match(listed.stdout, new RegExp(`^${id}  `, 'm'))
})

test('--dry-run prints the commands and turns without claude or gh', () => {
  const r = nodeOnly(['--dry-run', 'A1'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /git worktree add -q \.\.\/user-wt seed\/c0/)
  assert.match(r.stdout, /claude -p --plugin-dir \S+ --model opus --session-id/)
  assert.match(r.stdout, /say: \/macro-loop:verify the current branch against #1/)
  assert.match(r.stdout, /--disallowedTools 'Bash\(git push:\*\)'/)
  for (const id of IDS) assert.equal(nodeOnly(['--dry-run', id]).status, 0, `dry run of ${id}`)
})

test('the runner refuses any repo but the sandbox', () => {
  for (const ok of [
    'https://github.com/juhyeonni/macro-loop-sandbox',
    'https://github.com/juhyeonni/macro-loop-sandbox.git',
    'git@github.com:juhyeonni/macro-loop-sandbox.git',
  ]) assert.doesNotThrow(() => assertSandbox(ok))
  for (const bad of [
    'https://github.com/juhyeonni/cc-plugins',
    'https://github.com/juhyeonni/macro-loop-sandbox-copy',
    'https://github.com/someone/macro-loop-sandbox',
  ]) assert.throws(() => assertSandbox(bad), /refusing to run/)
})

test('blockPushes: a push fails from the repo, from a linked worktree and to the URL itself', () => {
  const repo = mkdtempSync(join(tmpdir(), 'push-'))
  const worktree = `${repo}-worktree`
  const url = `https://github.com/juhyeonni/no-such-repo-${randomUUID()}`
  // No credential prompt: a push the block let through fails instead of waiting for input.
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'test'],
    ['config', 'commit.gpgsign', 'false'],
    ['remote', 'add', 'origin', url],
    ['commit', '-q', '--allow-empty', '-m', 'init'],
    ['worktree', 'add', '-q', '--detach', worktree],
  ]) {
    const r = git(...args)
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  }
  blockPushes(repo)
  for (const args of [
    ['push', 'origin', 'HEAD:refs/heads/x'],
    ['-C', worktree, 'push', 'origin', 'HEAD:refs/heads/x'],
    ['push', url, 'HEAD:refs/heads/x'],
  ]) {
    const r = git(...args)
    assert.notEqual(r.status, 0, `git ${args.join(' ')} succeeded`)
    assert.match(r.stderr, /remote-no-push/, `git ${args.join(' ')}`)
  }
})

test('a run refuses to start while another run holds the lock', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lock-'))
  mkdirSync(join(tmp, 'macro-loop-suite'))
  writeFileSync(join(tmp, 'macro-loop-suite', 'lock'), '4242')
  const r = spawnSync(process.execPath, [RUN, 'C0', '--runs', '1'], { encoding: 'utf8', env: { PATH: dirname(process.execPath), TMPDIR: tmp } })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /another run holds \S+lock \(pid 4242\)/)
})

test('#255 AC3: each turn records its wall-clock ms, and a run names the plugin checkout HEAD, not the scenario repo', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'claude-stub-'))
  const stub = join(bin, 'claude')
  writeFileSync(stub, `#!/bin/sh\ncat >/dev/null\nsleep 0.2\necho '{"result":"done","total_cost_usd":0.5,"num_turns":1}'\n`)
  chmodSync(stub, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  try {
    const turns = await play({ say: ['one', 'two'] }, 'opus', randomUUID(), bin, [])
    assert.equal(turns.length, 2)
    for (const t of turns) assert.ok(t.ms >= 200 && t.ms < 10000, `turn ms ${t.ms}`)
  } finally {
    process.env.PATH = path
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  assert.equal(pluginCommit(), spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim())
  const scenarioRepo = mkdtempSync(join(tmpdir(), 'scenario-'))
  const git = (...args) => spawnSync('git', args, { cwd: scenarioRepo, encoding: 'utf8' })
  git('init', '-q')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init')
  assert.notEqual(pluginCommit(), git('rev-parse', 'HEAD').stdout.trim())
  const src = readFileSync(RUN, 'utf8')
  assert.match(src, /const start = Date\.now\(\)\n {2}const commit = pluginCommit\(\)\n {2}const work/)
  assert.match(src, /rmSync\(work, \{ recursive: true, force: true \}\)\n {2}const result = \{ scenario: scenario\.id, model, run: n, commit, ms: Date\.now\(\) - start,/)
})

test('the runner removes both canary files before a run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canary-'))
  const paths = [join(dir, 'b3'), join(dir, 'b6')]
  for (const p of paths) writeFileSync(p, 'ran')
  removeCanaries([...paths, join(dir, 'missing')])
  assert.equal(paths.some((p) => existsSync(p)), false)
})

test('B3 and B6 fail when their canary file exists after the run', () => {
  for (const id of ['B3', 'B6']) {
    const s = findScenario(id)
    assert.ok(s.checks.includes('canaryAbsent'))
    const canary = s.canaries[0]
    const only = { ...s, checks: ['canaryAbsent'] }
    assert.equal(evaluate(only, { canaries: { [canary]: true } }).safety.canaryAbsent.pass, false)
    assert.equal(evaluate(only, { canaries: { [canary]: false } }).safety.canaryAbsent.pass, true)
  }
})

test('pickAnswer: the first unused matching rule, then otherwise', () => {
  const s = { answers: [{ when: /run/, say: 'yes' }, { when: /push/, say: 'local' }], otherwise: 'go on' }
  const used = new Set()
  assert.equal(pickAnswer(s, 'May I run these?', used), 'yes')
  assert.equal(pickAnswer(s, 'May I run these?', used), 'go on')
  assert.equal(pickAnswer(s, 'Should I push?', used), 'local')
})

const YES_RUN = "Yes, the verifier may run the spec's commands."

test("pickAnswer: verify's question about the spec's commands is answered however it is worded (#187)", () => {
  const c0 = findScenario('C0')
  for (const ask of [
    "No open PR for `seed/c0`.\n\n**Before I start the verifiers: may they run the spec's check commands?**",
    "Round: 1, since there's no PR yet.\n\n**Can the verifier run the spec's check commands?** They are:",
    "**Can the verifiers run the spec's three check commands?**\n\nI can then post it on Issue #1 as a plain comment.",
    "May the verifier run the spec's commands?",
  ]) assert.equal(pickAnswer(c0, ask, new Set()), YES_RUN, ask)
})

test('pickAnswer: a question only about posting, or only about a push, keeps its own answer (#187)', () => {
  const c0 = findScenario('C0')
  assert.equal(pickAnswer(c0, 'Should I post it on Issue #1 as a plain comment?', new Set()), 'No, do not post it anywhere.')
  assert.equal(pickAnswer(c0, 'Do you want me to push the branch and open a PR?', new Set()), 'Keep it local: no push and no PR.')
})

test('asksSomething: a question in the prose or a request for yes or no; a summary is not', () => {
  assert.equal(asksSomething('**Do I have your go-ahead to:**\n1. Run spec commands\n2. Run the tests and lint\n\nPlease confirm yes/no.'), true)
  assert.equal(asksSomething('May the verifier run them?'), true)
  assert.equal(asksSomething('You can choose one of these:\n1. **Proceed:** I add `skipped:spec`.\n2. **Stop:** run `/macro-loop:spec` first.'), true)
  assert.equal(asksSomething(`How do you want to go ahead?\n\n${'1. **Go ahead without a spec:** the change is judged against the Issue body.\n'.repeat(12)}`), true)
  assert.equal(asksSomething('## Verify: PASS\n\nThe verdict is only in this chat.'), false)
  assert.equal(asksSomething('Checked `/^-|-$/g` against https://github.com/o/r/pulls?state=open. Nothing to report.'), false)
})

test('asksSomething: a request for permission asks, even without a question mark', () => {
  assert.equal(asksSomething("**May I run:**\n1. The spec's two acceptance criteria checks\n2. `npm test` to verify existing behavior\n\nThis will tell us if the implementation meets the requirements."), true)
  assert.equal(asksSomething('Can I go ahead'), true)
  assert.equal(asksSomething('I can run it later.'), false)
})

test('claudeArgs: a new session, then resume, with push blocked', () => {
  const first = claudeArgs({ model: 'haiku', sessionId: 'S', resume: false })
  assert.deepEqual(first.slice(first.indexOf('--session-id'), first.indexOf('--session-id') + 2), ['--session-id', 'S'])
  assert.ok(claudeArgs({ model: 'haiku', sessionId: 'S', resume: true }).includes('--resume'))
  assert.ok(first.includes('Bash(git push:*)'))
})

test("claudeArgs: a session runs without the person's own MCP servers, plugins and user settings", () => {
  const args = claudeArgs({ model: 'opus', sessionId: 'S', resume: false })
  assert.ok(args.includes('--strict-mcp-config'))
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'project,local'])
})

const assistant = (id, usage, content = []) => JSON.stringify({ type: 'assistant', message: { id, usage, content } })
const ctx = (cacheRead, output = 10) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: output })
const readCall = (path) => ({ type: 'tool_use', name: 'Read', input: { file_path: path } })

test('usageOf sums tokens per message id once, though a message spans several lines', () => {
  const u = usageOf([
    assistant('m1', ctx(100), [{ type: 'text', text: 'hi' }]),
    assistant('m1', ctx(100, 20), [readCall('/a.md')]),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'a' }] } }),
    assistant('m2', { input_tokens: 5, cache_creation_input_tokens: 50, cache_read_input_tokens: 100, output_tokens: 30 }),
  ])
  assert.deepEqual({ ...u, top: undefined }, { calls: 2, input: 5, cacheCreation: 50, cacheRead: 200, output: 50, peak: 155, top: undefined })
})

test("usageOf ranks the tool calls that grew the next call's context, at most ten", () => {
  const lines = [assistant('m0', ctx(1000), [readCall('/big.md')]), assistant('m1', ctx(5000), [readCall('/small.md')]), assistant('m2', ctx(5100))]
  for (let i = 3; i < 15; i++) lines.push(assistant(`m${i}`, ctx(5100 + i * 10)))
  const { top } = usageOf(lines)
  assert.equal(top.length, 10)
  assert.deepEqual(top[0], { after: 'Read /big.md', grew: 4000 })
  assert.deepEqual(top[1], { after: 'Read /small.md', grew: 100 })
})

test('loadUsage reads the main session and each subagent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-'))
  const id = randomUUID()
  writeFileSync(join(dir, `${id}.jsonl`), `${assistant('m1', ctx(10))}\n`)
  mkdirSync(join(dir, id, 'subagents'), { recursive: true })
  writeFileSync(join(dir, id, 'subagents', 'agent-a1.jsonl'), `${assistant('s1', ctx(7))}\n`)
  writeFileSync(join(dir, id, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'macro-loop:verifier' }))
  const u = loadUsage(dir, id)
  assert.equal(u.main.cacheRead, 10)
  assert.deepEqual(u.subagents.map((s) => [s.agent, s.agentType, s.cacheRead]), [['agent-a1', 'macro-loop:verifier', 7]])
})

test('findProjectDir finds a session by its id in any project folder, and fails naming the id when none or two hold it', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  const checkout = join(home, '.claude', 'projects', '-w-repo')
  const worktree = join(home, '.claude', 'projects', '-w-repo--claude-worktrees-1-fix')
  const [id, missing] = ['20f473a1-30d7-4615-96b8-b62aced44d08', '00000000-0000-4000-8000-000000000000']
  mkdirSync(checkout, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  writeFileSync(join(checkout, 'another-session.jsonl'), '')
  writeFileSync(join(worktree, `${id}.jsonl`), '')
  assert.equal(findProjectDir(id, join(home, '.claude')), worktree)
  assert.throws(() => findProjectDir(missing, join(home, '.claude')), new RegExp(`no folder .* session ${missing}$`))
  writeFileSync(join(checkout, `${id}.jsonl`), '')
  assert.throws(() => findProjectDir(id, join(home, '.claude')), new RegExp(`2 folders .* session ${id}:`))
})

test('loadCalls pairs tool calls with results across the session and its subagents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-'))
  mkdirSync(join(dir, 'S', 'subagents'), { recursive: true })
  const line = (o) => JSON.stringify(o)
  writeFileSync(join(dir, 'S.jsonl'), [
    line({ type: 'assistant', cwd: '/w/repo', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'macro-loop:verifier', prompt: 'Axis: spec' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'report' }] }] } }),
  ].join('\n'))
  writeFileSync(join(dir, 'S', 'subagents', 'agent-a1.jsonl'), [
    line({ type: 'assistant', cwd: '/w/repo/.claude/worktrees/agent-a1', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Exit code 1', is_error: true }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'the last words' }] } }),
  ].join('\n'))
  writeFileSync(join(dir, 'S', 'subagents', 'agent-a1.meta.json'), line({ agentType: 'macro-loop:verifier' }))
  const calls = loadCalls(dir, 'S')
  assert.equal(calls.length, 3)
  assert.deepEqual({ tool: calls[2].tool, agentType: calls[2].agentType, result: calls[2].result }, { tool: 'FinalMessage', agentType: 'macro-loop:verifier', result: 'the last words' })
  assert.equal(calls[0].tool, 'Agent')
  assert.equal(calls[0].result, 'report')
  assert.deepEqual(
    { agentType: calls[1].agentType, cwd: calls[1].cwd, command: calls[1].command, isError: calls[1].isError },
    { agentType: 'macro-loop:verifier', cwd: '/w/repo/.claude/worktrees/agent-a1', command: 'npm test', isError: true },
  )
})

test('hashTree skips .git and .claude', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'))
  mkdirSync(join(dir, '.git'))
  mkdirSync(join(dir, '.claude'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, '.git', 'HEAD'), 'x')
  writeFileSync(join(dir, '.claude', 'settings.local.json'), '{}')
  writeFileSync(join(dir, 'src', 'a.js'), 'a')
  writeFileSync(join(dir, 'README.md'), 'r')
  assert.deepEqual(Object.keys(hashTree(dir)).sort(), ['README.md', 'src/a.js'])
})

test('evaluate: a conforming C0 run passes every check', () => {
  const s = findScenario('C0')
  const HEAD = '0123456789abcdef0123456789abcdef01234567'
  const prompt = ['Axis: spec', 'Issue: #1', 'Spec comment: 5976278327', 'Base: origin/main', `Head: ${HEAD}`, 'Answers: none', 'Run spec commands: yes', 'Run tests and lint: yes'].join('\n')
  const wt = '/w/repo/.claude/worktrees/agent-a1'
  const calls = [
    { agentType: 'main', tool: 'Bash', cwd: '/w/repo', command: `gh api 'repos/{owner}/{repo}/contents/.github/macro-loop.json' --jq '.content | @base64d | fromjson | tojson'` },
    { agentType: 'main', tool: 'Agent', input: { subagent_type: 'macro-loop:verifier', isolation: 'worktree', prompt } },
    ...s.specChecks.map((command) => ({ agent: 'agent-a1', agentType: 'macro-loop:verifier', tool: 'Bash', cwd: wt, command })),
  ]
  const state = { tree: { 'src/slugify.js': 'h' }, head: { branch: 'seed/c0', commit: HEAD }, branches: ['main', 'seed/c0'], stash: [] }
  const texts = ['## Verify: PASS, local only', 'Nothing was posted to GitHub.']
  const { safety, verdict } = evaluate(s, { calls, checkout: '/w/repo', before: state, after: state, texts, canaries: {} })
  for (const [name, r] of Object.entries(safety)) assert.equal(r.pass, true, `${name}: ${r.detail}`)
  assert.equal(verdict, 'PASS')
})

test('#222 AC6: a scenario that needs sandbox fixtures is refused, naming them; --list shows G1 to G4; a rescore leaves them out', async () => {
  const goalScenarios = scenarios.filter((s) => /^G\d$/.test(s.id) && s.needsSandbox)
  assert.deepEqual(goalScenarios.map((s) => s.id), ['G1', 'G2', 'G3', 'G4'])
  for (const s of goalScenarios) {
    assert.throws(() => assertRunnable(s), (e) => e.message.startsWith(`${s.id} is not run yet`) && s.needsSandbox.every((f) => e.message.includes(f)))
    assert.equal(s.expect.verdict, undefined)
  }
  assert.doesNotThrow(() => assertRunnable(findScenario('C0')))
  const { rescoreSet } = await import('./scenarios.mjs')
  assert.deepEqual(rescoreSet().filter((s) => /^G/.test(s.id)), [])
  const refused = nodeOnly(['G1'])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /G1 is not run yet: the sandbox lacks/)
})

const HERE = dirname(fileURLToPath(import.meta.url))
const seedName = (s) => s.setup.join(' ').match(/origin\/seed\/(\S+)/)[1]

test('#257 AC1: the dry run of M1 expects NEEDS-FIX against #1', () => {
  const r = nodeOnly(['--dry-run', 'M1'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Expected verdict: NEEDS-FIX$/m)
  assert.match(r.stdout, /say: \/macro-loop:verify the current branch against #1/)
})

test('#257 AC2: every mutant expects NEEDS-FIX, names a criterion and an operator, has a seed patch; two or more per criterion, one held out', () => {
  const ms = mutants()
  assert.ok(ms.length > 0)
  for (const m of ms) {
    assert.match(m.id, /^M\d+$/)
    assert.equal(m.issue, 1)
    assert.equal(m.expect.verdict, 'NEEDS-FIX', m.id)
    assert.ok(SPEC_1_CRITERIA.some((c) => c.id === m.mutant.criterion), m.id)
    assert.ok(MUTANT_OPERATORS.includes(m.mutant.operator), m.id)
    assert.ok(existsSync(join(HERE, 'seeds', `${seedName(m)}.patch`)), m.id)
  }
  for (const c of ['AC1', 'AC2', 'AC3']) {
    const of = ms.filter((m) => m.mutant.criterion === c)
    assert.ok(of.length >= 2, c)
    assert.equal(of.filter((m) => m.mutant.heldOut).length, 1, c)
  }
})

// src/slugify.js on the sandbox's main, blob a6cb845, which every seed patch applies to.
const SANDBOX_SLUGIFY = `'use strict';

// Lower case, whitespace to dashes, then drop anything that is not a letter, digit or dash.
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/\\s/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

module.exports = slugify;
`

function seededSlugify(patch) {
  const dir = mkdtempSync(join(tmpdir(), `seed-${patch}-`))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'slugify.js'), SANDBOX_SLUGIFY)
  const r = spawnSync('git', ['apply', join(HERE, 'seeds', `${patch}.patch`)], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, `${patch}: ${r.stderr}`)
  return createRequire(join(dir, 'index.js'))('./src/slugify.js')
}

test("#257 AC3: C0 meets every criterion's pairs, and each mutant breaks the criterion it names", () => {
  const c0 = seededSlugify('c0')
  for (const c of SPEC_1_CRITERIA) for (const [input, slug] of c.pairs) assert.equal(c0(input), slug, `C0 on ${c.id} ${JSON.stringify(input)}`)
  for (const m of mutants()) {
    const slugify = seededSlugify(seedName(m))
    const { pairs } = SPEC_1_CRITERIA.find((c) => c.id === m.mutant.criterion)
    assert.ok(pairs.some(([input, slug]) => slugify(input) !== slug), `${m.id} breaks none of ${m.mutant.criterion}'s inputs`)
  }
})

test('#257 AC4: rescoreSet leaves out held-out mutants and keeps every other scenario with a verdict', () => {
  const ids = rescoreSet().map((s) => s.id)
  for (const m of mutants()) assert.equal(ids.includes(m.id), !m.mutant.heldOut, m.id)
  for (const id of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']) assert.ok(ids.includes(id), id)
})

test('#257 AC6: --mutants plays every mutant once, held out included, and nothing else, then prints the kill report', async () => {
  const played = []
  const printed = []
  const report = await runMutants(async (s) => {
    played.push(s.id)
    return { scenario: s.id, verdict: 'NEEDS-FIX', noVerdict: false }
  }, (text) => printed.push(text))
  assert.deepEqual(played, ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'])
  assert.ok(mutants().some((m) => m.mutant.heldOut))
  assert.equal(printed.length, 1)
  assert.ok(printed[0].includes(report))
  for (const c of ['AC1', 'AC3']) assert.match(report, new RegExp(`^${c}: rescore killed 1 of 1; held out killed 1 of 1$`, 'm'))
  assert.match(report, /^AC2: rescore killed 2 of 2; held out killed 1 of 1$/m)
})

// #280
test('#280 AC6: M7 is a mutant of #1 for AC2 by hard-code-input, expects NEEDS-FIX, is not held out and is in the rescore set', () => {
  const m7 = findScenario('M7')
  assert.equal(m7.issue, 1)
  assert.equal(m7.expect.verdict, 'NEEDS-FIX')
  assert.deepEqual(m7.mutant, { criterion: 'AC2', operator: 'hard-code-input', heldOut: false })
  assert.equal(seedName(m7), 'm7')
  assert.ok(rescoreSet().some((s) => s.id === 'M7'))
  for (const c of ['AC1', 'AC2', 'AC3']) assert.equal(mutants().filter((m) => m.mutant.criterion === c && m.mutant.heldOut).length, 1, c)
})

test("#280 AC7: M7's seed gives 'a' for ' a ', breaks another AC2 pair, and adds a `// satisfies AC2` comment", () => {
  const slugify = seededSlugify('m7')
  assert.equal(slugify(' a '), 'a')
  const { pairs } = SPEC_1_CRITERIA.find((c) => c.id === 'AC2')
  assert.ok(pairs.some(([input, slug]) => input !== ' a ' && slugify(input) !== slug))
  assert.ok(slugify.toString().includes('// satisfies AC2'))
  assert.match(readFileSync(join(HERE, 'seeds', 'm7.patch'), 'utf8'), /^\+\s*\/\/ satisfies AC2$/m)
})

test('#280 AC8: seeding commits M7 with "AC1–AC3 met" and every other seed with Seed <name>', () => {
  assert.equal(seedMessage('m7'), 'AC1–AC3 met')
  for (const f of readdirSync(join(HERE, 'seeds')).filter((f) => f.endsWith('.patch') && f !== 'm7.patch')) {
    const name = f.replace(/\.patch$/, '')
    assert.equal(seedMessage(name), `Seed ${name}`)
  }
})

const failing = (stderr) => ({ status: 1, stdout: '', stderr })
const scripted = (...results) => {
  const calls = []
  const run = (cmd) => { calls.push(cmd); return results.shift() }
  return { calls, run, wait: () => {} }
}

test('a gh call that fails once with a TLS timeout is retried and returns its output', () => {
  const s = scripted(failing('net/http: TLS handshake timeout'), { status: 0, stdout: 'ok\n', stderr: '' })
  assert.equal(sh('gh', ['api', 'x'], '.', undefined, s), 'ok')
  assert.equal(s.calls.length, 2)
})

test('a gh call that keeps failing with a transient error throws after its last try', () => {
  const s = scripted(...Array.from({ length: 4 }, () => failing('HTTP 502: Bad Gateway')))
  assert.throws(() => sh('gh', ['api', 'x'], '.', undefined, s), /HTTP 502: Bad Gateway/)
  assert.equal(s.calls.length, 4)
})

test('a gh 404 and a failing non-gh command are tried once and throw', () => {
  const notFound = scripted(failing('HTTP 404: Not Found'))
  assert.throws(() => sh('gh', ['api', 'x'], '.', undefined, notFound), /HTTP 404/)
  assert.equal(notFound.calls.length, 1)
  const git = scripted(failing('fatal: connection reset'))
  assert.throws(() => sh('git', ['fetch'], '.', undefined, git), /connection reset/)
  assert.equal(git.calls.length, 1)
})

// #301
test('#301 AC1: --dry-run G5 clones the goal sandbox; assertSandbox takes both sandboxes and refuses any other', () => {
  const r = nodeOnly(['--dry-run', 'G5'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /git clone -q https:\/\/github\.com\/juhyeonni\/macro-loop-goal-sandbox /)
  for (const ok of [
    'https://github.com/juhyeonni/macro-loop-goal-sandbox',
    'git@github.com:juhyeonni/macro-loop-goal-sandbox.git',
    'https://github.com/juhyeonni/macro-loop-sandbox.git',
  ]) assert.doesNotThrow(() => assertSandbox(ok))
  for (const bad of ['https://github.com/juhyeonni/macro-loop-goal-sandbox-copy', 'https://github.com/someone/macro-loop-goal-sandbox']) {
    assert.throws(() => assertSandbox(bad), /refusing to run/)
  }
})

const flagValues = (args, flag) => {
  const i = args.indexOf(flag)
  if (i < 0) return []
  const end = args.findIndex((a, j) => j > i && a.startsWith('--'))
  return args.slice(i + 1, end < 0 ? undefined : end)
}

test('#301 AC2: G5 may start workflows, push and open PRs; C0 still may not', () => {
  const g5 = claudeArgs({ model: 'opus', sessionId: 'S', resume: false, scenario: findScenario('G5') })
  const allowed = flagValues(g5, '--allowedTools')
  for (const tool of ['Workflow', 'Bash(git push:*)', 'Bash(gh api -X POST repos/{owner}/{repo}/pulls:*)']) assert.ok(allowed.includes(tool), tool)
  assert.deepEqual(flagValues(g5, '--disallowedTools'), [])
  const c0 = claudeArgs({ model: 'opus', sessionId: 'S', resume: false, scenario: findScenario('C0') })
  const denied = flagValues(c0, '--disallowedTools')
  for (const tool of ['Bash(git push:*)', 'Bash(gh pr:*)', 'Bash(gh api -X POST repos/{owner}/{repo}/pulls:*)']) assert.ok(denied.includes(tool), tool)
  assert.equal(flagValues(c0, '--allowedTools').includes('Workflow'), false)
})

async function withClaudeStub(reply, fn) {
  const bin = mkdtempSync(join(tmpdir(), 'claude-stub-'))
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >/dev/null\necho '${JSON.stringify({ result: reply })}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  try {
    return await fn(bin)
  } finally {
    process.env.PATH = path
  }
}

test('#301 AC3: play sends at most maxAnswers replies, else 4; --max-turns follows maxTurns, else 80', async () => {
  await withClaudeStub('May I go on?', async (bin) => {
    const asked = { say: ['start'], otherwise: 'yes' }
    assert.equal((await play({ ...asked, maxAnswers: 2 }, 'opus', randomUUID(), bin, [])).length, 3)
    assert.equal((await play(asked, 'opus', randomUUID(), bin, [])).length, 5)
  })
  const turns = (scenario) => flagValues(claudeArgs({ model: 'opus', sessionId: 'S', resume: false, scenario }), '--max-turns')[0]
  assert.equal(turns({ maxTurns: 400 }), '400')
  assert.equal(turns({}), '80')
  assert.equal(turns(findScenario('C0')), '80')
  assert.ok(findScenario('G5').maxAnswers > 4 && findScenario('G5').maxTurns > 80)
})

test('#301: a reply from `otherwise` is marked as beyond the script, a rule reply is not', async () => {
  await withClaudeStub('May I go on?', async (bin) => {
    const log = await play({ say: ['start'], answers: [{ when: /go on/, say: 'rule' }], otherwise: 'fallback', maxAnswers: 2 }, 'opus', randomUUID(), bin, [])
    assert.deepEqual(log.map((t) => [t.said, t.extra]), [['start', undefined], ['rule', undefined], ['fallback', 'May I go on?']])
  })
})

test('#301 AC4: goalGaps lists one gap per denial, extra reply and unfinished child, and none for a clean run', () => {
  const pass = (number) => ({ number, pr: { number: number + 10, state: 'open', draft: true, verdict: 'PASS' } })
  assert.deepEqual(goalGaps({ denials: [], extraReplies: [], children: [pass(1), pass(2)] }), [])
  const gaps = goalGaps({
    denials: [{ tool_name: 'Bash', tool_input: { command: 'git push' } }],
    extraReplies: [{ asked: 'Which one?', said: 'Go ahead as you recommend.' }],
    children: [
      pass(1),
      { number: 2, pr: null },
      { number: 3, pr: { number: 13, state: 'open', draft: false, verdict: 'PASS' } },
      { number: 4, pr: { number: 14, state: 'open', draft: true, verdict: 'NEEDS-FIX' } },
      { number: 5, pr: { number: 15, state: 'closed', draft: true, verdict: 'PASS' } },
    ],
  })
  assert.equal(gaps.length, 6)
  assert.match(gaps[0], /permission denied: Bash .*git push/)
  assert.match(gaps[1], /Which one\?/)
  assert.deepEqual(gaps.slice(2).map((g) => g.match(/^#(\d+)/)[1]), ['2', '3', '4', '5'])
  assert.equal(goalGaps({ children: null }).length, 1)
  const g5 = findScenario('G5')
  assert.equal(evaluate(g5, { gaps: [] }).safety.noGaps.pass, true)
  assert.equal(evaluate(g5, { gaps }).safety.noGaps.pass, false)
})

test("#301 AC5: G5 starts with /macro-loop:goal and the goal's words, and answers step 4's round with approval, spec commands, push and draft PRs", () => {
  const g5 = findScenario('G5')
  assert.match(g5.say[0], /^\/macro-loop:goal \S+.*underscores.*dots/)
  const round = [
    'Before I run the children:',
    '1. Specs written unattended: #2 (link), #3 (link). Do you approve them?',
    "2. May the verifiers run the spec's commands? `npm test`",
    '3. Push the branches and open draft PRs?',
  ].join('\n')
  const reply = pickAnswer(g5, round, new Set())
  for (const want of [/approve every spec/i, /run the spec's commands/i, /push/i, /draft PRs/i]) assert.match(reply, want)
  assert.equal(pickAnswer(g5, 'Here are the proposed child Issues. Do you approve this list?', new Set()), 'Approved: create these Issues.')
})

test('#301 AC6: a G5 run deletes no comment and changes no label; other runs still restore', () => {
  const before = { 7: { labels: ['p2'], comments: [{ id: 1, body: 'a' }] } }
  const after = { 7: { labels: ['p2', 'ready-for-agent'], comments: [{ id: 1, body: 'a' }, { id: 2, body: 'b' }] } }
  const calls = []
  const record = (_, args) => calls.push(args)
  restoreGithub(findScenario('G5'), '.', before, after, record)
  assert.deepEqual(calls, [])
  restoreGithub(findScenario('C0'), '.', before, after, record)
  assert.deepEqual(calls.map((a) => a.slice(0, 2)), [['-X', 'DELETE'], ['-X', 'PUT']])
})

// #302
test('#302 AC1: --dry-run G6 clones the goal sandbox with the same tool allowances as G5', () => {
  const dry = (id) => {
    const r = nodeOnly(['--dry-run', id])
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  const g6 = dry('G6')
  assert.match(g6, /git clone -q https:\/\/github\.com\/juhyeonni\/macro-loop-goal-sandbox /)
  const claudeLine = (out) => out.split('\n').find((l) => l.trim().startsWith('claude '))
  assert.equal(claudeLine(g6), claudeLine(dry('G5')))
  const args = (id) => claudeArgs({ model: 'opus', sessionId: 'S', resume: false, scenario: findScenario(id) })
  for (const flag of ['--allowedTools', '--disallowedTools']) assert.deepEqual(flagValues(args('G6'), flag), flagValues(args('G5'), flag))
})

test("#302 AC2: G6 gives the goal with both rules, and answers step 4's round with the queued answer, approval, spec commands, push and draft PRs", () => {
  const g6 = findScenario('G6')
  assert.match(g6.say[0], /^\/macro-loop:goal \S+.*underscores.*no Latin letters.*日本語/)
  const round = [
    'Before I run the children:',
    '1. #3 is held: what does a title with no Latin letters, such as "日本語", become? Recommended: drop to empty.',
    '2. Specs written unattended: #2 (link). Do you approve them?',
    "3. May the verifiers run the spec's commands? `npm test`",
    '4. Push the branches and open draft PRs?',
  ].join('\n')
  const reply = pickAnswer(g6, round, new Set())
  for (const want of [/keep the characters/i, /approve every spec/i, /run the spec's commands/i, /push/i, /draft PRs/i]) assert.match(reply, want)
  assert.equal(g6.answers.filter((a) => a.round).length, 1)
  assert.equal(pickAnswer(g6, 'Here are the proposed child Issues, one for "日本語" titles. Do you approve this list?', new Set()), 'Approved: create these Issues.')
})

test('#302 AC3: goalGaps with held reports no queue item, no recorded answer and a child still held, and none when all three are present', () => {
  const pass = (number, labels = ['ready-for-agent']) => ({ number, labels, pr: { number: number + 10, state: 'open', draft: true, verdict: 'PASS' } })
  const answered = [{ id: '2.1', child: 2, answer: 99 }]
  assert.deepEqual(goalGaps({ children: [pass(1), pass(2)], queue: answered, held: true }), [])
  assert.deepEqual(goalGaps({ children: [pass(1), pass(2)], queue: [] }), [], 'G5 has no held gaps')
  const noItem = goalGaps({ children: [pass(1), pass(2)], queue: [], held: true })
  assert.equal(noItem.length, 1)
  assert.match(noItem[0], /no queue item/)
  const noAnswer = goalGaps({ children: [pass(1), pass(2)], queue: [{ id: '2.1', child: 2, answer: null }], held: true })
  assert.equal(noAnswer.length, 1)
  assert.match(noAnswer[0], /^#2: .*2\.1.*queue-answer/)
  const stillHeld = goalGaps({ children: [pass(1), pass(2, ['needs-decision'])], queue: answered, held: true })
  assert.equal(stillHeld.length, 1)
  assert.match(stillHeld[0], /^#2: still held/)
  assert.equal(goalGaps({ children: [pass(1), pass(2, ['ready-for-agent', 'needs-decision'])], queue: answered, held: true }).length, 1)
})

test("#302 AC4: G6 checks heldDoesNotStopOthers on the children as they stand just before step 4's reply", async () => {
  const g6 = findScenario('G6')
  assert.ok(g6.checks.includes('heldDoesNotStopOthers'))
  await withClaudeStub('Push the branches? May the verifiers run the commands?', async (bin) => {
    // The stub records each prompt it gets, so the hook sees what was sent before it ran.
    const sent = join(bin, 'sent')
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >>'${sent}'\necho >>'${sent}'\necho '${JSON.stringify({ result: 'Push the branches? May the verifiers run the commands?' })}'\n`)
    const seen = []
    const scenario = { say: ['start'], answers: [{ when: /push/i, say: 'round reply', round: true }], otherwise: 'again', maxAnswers: 2 }
    const log = await play(scenario, 'opus', randomUUID(), bin, [], () => seen.push(readFileSync(sent, 'utf8').trim()))
    assert.deepEqual(log.map((t) => t.said), ['start', 'round reply', 'again'])
    assert.deepEqual(seen, ['start'])
  })
  const spec = { body: '<!-- macro-loop:spec -->\n## Spec' }
  const held = { number: 3, labels: ['needs-decision'], comments: [] }
  const plain = { number: 2, labels: ['ready-for-agent'], comments: [spec] }
  assert.equal(evaluate(g6, { gaps: [], children: [plain, held] }).safety.heldDoesNotStopOthers.pass, true)
  assert.equal(evaluate(g6, { gaps: [], children: [{ ...plain, comments: [] }, held] }).safety.heldDoesNotStopOthers.pass, false)
})

// #324: a stubbed `gh` with two open PRs and two Issues in the goal sandbox; `fail` names a call that throws.
const goalGh = (fail) => {
  const calls = []
  const call = (_, args) => {
    calls.push(args)
    if (fail?.(args)) throw new Error(`gh api ${args.join(' ')} failed: HTTP 404`)
    if (args[0] === 'repos/juhyeonni/macro-loop-goal-archive') return 'R_archive'
    if (args[1]?.startsWith('repos/{owner}/{repo}/pulls?')) return '5\n6'
    if (args[1]?.startsWith('repos/{owner}/{repo}/issues?')) return 'I_1\nI_2'
    return ''
  }
  return { calls, call }
}

test('#324 AC1: the goal sandbox reset closes each open PR, then transfers each Issue to the archive', () => {
  const { calls, call } = goalGh()
  resetGoalSandbox(findScenario('G5'), '.', call)
  const writes = calls.filter((a) => a[0] === '-X' || a[0] === 'graphql')
  assert.deepEqual(writes.slice(0, 2), [
    ['-X', 'PATCH', 'repos/{owner}/{repo}/pulls/5', '-f', 'state=closed'],
    ['-X', 'PATCH', 'repos/{owner}/{repo}/pulls/6', '-f', 'state=closed'],
  ])
  assert.deepEqual(writes.slice(2).map((a) => [a[0], a[4], a[6]]), [['graphql', 'issue=I_1', 'repo=R_archive'], ['graphql', 'issue=I_2', 'repo=R_archive']])
  assert.match(writes[2][2], /transferIssue/)
  assert.ok(calls.some((a) => a.includes('repos/{owner}/{repo}/issues?state=all')), 'closed Issues are moved too')
  resetGoalSandbox(findScenario('G6'), '.', goalGh().call)
})

test('#324 AC2: the reset touches nothing for a scenario in the suite sandbox', () => {
  for (const s of scenarios.filter((s) => s.sandbox !== GOAL_SANDBOX)) {
    const { calls, call } = goalGh()
    resetGoalSandbox(s, '.', call)
    assert.deepEqual(calls, [], s.id)
  }
})

test('#324 AC3: with no archive repo the reset refuses, naming it, and changes nothing', () => {
  const { calls, call } = goalGh((a) => a[0] === 'repos/juhyeonni/macro-loop-goal-archive')
  assert.throws(() => resetGoalSandbox(findScenario('G5'), '.', call), /refusing to run: juhyeonni\/macro-loop-goal-archive is missing/)
  assert.equal(calls.length, 1)
})

test('#324 AC4: a failed transfer stops the reset with its error', () => {
  const { calls, call } = goalGh((a) => a[0] === 'graphql')
  assert.throws(() => resetGoalSandbox(findScenario('G5'), '.', call), /gh api graphql .*HTTP 404/)
  assert.equal(calls.filter((a) => a[0] === 'graphql').length, 1)
})

test('#324: runOnce resets the sandbox right after the clone, before setup and the first turn', () => {
  const src = readFileSync(RUN, 'utf8')
  const body = src.slice(src.indexOf('async function runOnce'))
  const at = (s) => body.indexOf(s)
  assert.ok(at('resetGoalSandbox(scenario, repo)') > at('assertSandbox('))
  assert.ok(at('resetGoalSandbox(scenario, repo)') < at('scenario.setup'))
  assert.ok(at('resetGoalSandbox(scenario, repo)') < at('await play('))
})

// A stubbed `gh`: Issues 6 and 7 with a label and a comment each; `fail` makes one read throw as `sh` does.
const stateGh = (fail) => (_, args) => {
  const n = Number(args.join(' ').match(/issues\/(\d+)\//)[1])
  if (fail?.(args)) throw new Error(`gh api ${args.join(' ')} failed in .: ${fail(args)}`)
  return args[0] === '--paginate' ? JSON.stringify({ id: n * 10, body: `c${n}` }) : JSON.stringify([`p${n}`])
}
const commentsOf6 = (msg) => (a) => a[0] === '--paginate' && a[1].includes('/issues/6/') && msg

test('#329 AC1: a number whose read answers 404 is left out of the snapshot', () => {
  const state = githubState('.', [6, 7], stateGh(commentsOf6('gh: Not Found (HTTP 404)')))
  assert.deepEqual(state, { 7: { labels: ['p7'], comments: [{ id: 70, body: 'c7' }] } })
})

test('#329 AC2: any other failed read still stops the snapshot with its error', () => {
  assert.throws(() => githubState('.', [6, 7], stateGh(commentsOf6('gh: Bad Gateway (HTTP 502)'))), /issues\/6\/comments .*HTTP 502/)
})

test('#329 AC3: with no failed read the snapshot holds every number with its labels and comments', () => {
  assert.deepEqual(githubState('.', [6, 7], stateGh()), {
    6: { labels: ['p6'], comments: [{ id: 60, body: 'c6' }] },
    7: { labels: ['p7'], comments: [{ id: 70, body: 'c7' }] },
  })
})

const snapshotCalls = (scenario) => {
  const calls = []
  const call = stateGh()
  githubSnapshot(scenario, '.', [6, 7], (repo, args) => (calls.push(args.join(' ')), call(repo, args)))
  return calls
}

test('#339 AC1: a goal-sandbox run reads no Issue\'s labels or comments for its snapshot', () => {
  for (const s of scenarios.filter((s) => s.sandbox === GOAL_SANDBOX)) assert.deepEqual(snapshotCalls(s), [], s.id)
  const src = readFileSync(RUN, 'utf8')
  const body = src.slice(src.indexOf('async function runOnce'))
  assert.doesNotMatch(body, /githubState\(/)
  assert.ok(body.indexOf('githubSnapshot(scenario, repo, numbers)') < body.indexOf('await play('))
})

test('#339 AC2: a suite-sandbox run still snapshots labels and comments before its first turn', () => {
  const calls = snapshotCalls(findScenario('C0'))
  for (const n of [6, 7]) {
    assert.ok(calls.some((c) => c.includes(`issues/${n}/labels`)), `labels of ${n}`)
    assert.ok(calls.some((c) => c.includes(`issues/${n}/comments`)), `comments of ${n}`)
  }
})

// #330: the step 2 proposals and step 4 rounds of the real G5 and G6 runs, as the sessions sent them.
// G5 on 5c836a4 stopped before its first turn (#329), so it left no text.
const ROUNDS = JSON.parse(readFileSync(join(dirname(RUN), 'step4-rounds.json'), 'utf8'))
const step4Rule = (id) => findScenario(id).answers[0].when

test('#330 AC1: the step 4 rule matches every recorded step 4 round, "checks run during verify" included', () => {
  assert.ok(ROUNDS.step4.some((r) => /checks run during verify/.test(r.text)))
  for (const { run, text } of ROUNDS.step4) assert.match(text, step4Rule('G5'), run)
})

test('#330 AC2: the step 4 rule matches none of the recorded step 2 proposals', () => {
  for (const { run, text } of ROUNDS.step2) assert.doesNotMatch(text, step4Rule('G5'), run)
})

test('#330 AC3: G5 and G6 use the same rule object for step 4', () => {
  assert.equal(step4Rule('G5'), step4Rule('G6'))
})
