import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate } from './checks.mjs'
import { asksSomething, assertSandbox, blockPushes, claudeArgs, hashTree, pickAnswer, removeCanaries } from './run.mjs'
import { findScenario, scenarios } from './scenarios.mjs'
import { findProjectDir, loadCalls, loadUsage, usageOf } from './transcript.mjs'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs')
const IDS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B6', 'C0', 'C1', 'C2', 'C3', 'C4', 'C6', 'D1', 'E1']

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
  assert.equal(findProjectDir(id, home), worktree)
  assert.throws(() => findProjectDir(missing, home), new RegExp(`no folder .* session ${missing}$`))
  writeFileSync(join(checkout, `${id}.jsonl`), '')
  assert.throws(() => findProjectDir(id, home), new RegExp(`2 folders .* session ${id}:`))
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
