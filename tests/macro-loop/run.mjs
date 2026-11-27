// Runs the macro-loop scenario suite against the sandbox repo (#28).
//
//   node tests/macro-loop/run.mjs --list
//   node tests/macro-loop/run.mjs --dry-run <ID> [--model opus]
//   node tests/macro-loop/run.mjs --seed
//   node tests/macro-loop/run.mjs <ID> [--model opus|haiku|sonnet] [--runs 3]
//   node tests/macro-loop/run.mjs --rescore [--resume <results dir>]
//   node tests/macro-loop/run.mjs --mutants
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { aggregate, evaluate, formatReport, goalGaps, killReport } from './checks.mjs'
import { findProjectDir, loadCalls, loadUsage } from './transcript.mjs'
import { BASELINE, confusion, formatAccuracy, formatPass3, isVerifierPath, loadRows, parseBaseline, rescoreToFile, retrying, saveRow } from './rescore.mjs'
import { closesAll } from '../../plugins/macro-loop/scripts/trust.mjs'
import { CANARIES, GOAL_ARCHIVE, GOAL_SANDBOX, SANDBOX, SPEC_1_CRITERIA, findScenario, mutants, rescoreSet, scenarios } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const PLUGIN_DIR = join(ROOT, 'plugins/macro-loop')
const SEEDS_DIR = join(here, 'seeds')
const RESULTS_DIR = join(here, 'results')
const WORK_ROOT = join(tmpdir(), 'macro-loop-suite')
const MODELS = ['opus', 'haiku']
const MAX_ANSWERS = 4

// Pushing and opening PRs are blocked: a blocked push is the user declining it.
// Only a scenario in the goal sandbox may push, open PRs and start workflows (#301 D4).
const GOAL_ALLOWED = ['Workflow', 'Bash(git push:*)', 'Bash(gh api -X POST repos/{owner}/{repo}/pulls:*)']
const DISALLOWED = ['Bash(git push:*)', 'Bash(gh pr:*)', 'Bash(gh api -X POST repos/{owner}/{repo}/pulls:*)']
const ALLOWED = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite',
  'Bash(gh api:*)', 'Bash(git:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mktemp:*)', 'Bash(grep:*)',
  'Bash(wc:*)', 'Bash(tail:*)', 'Bash(head:*)', 'Bash(jq:*)', 'Bash(node:*)', 'Bash(npm test:*)',
  'Bash(diff:*)', 'Bash(sed:*)', 'Bash(sort:*)', 'Bash(find:*)', 'Bash(test:*)', 'Bash(mkdir:*)',
  'Bash(printf:*)', 'Bash(echo:*)', 'Bash(rm /tmp/*)',
]

export function assertSandbox(remoteUrl) {
  const normalized = String(remoteUrl).trim().replace(/\.git$/, '')
  if (!/^(https:\/\/github\.com\/|git@github\.com:)juhyeonni\/macro-loop-(goal-)?sandbox$/.test(normalized)) {
    throw new Error(`refusing to run: ${remoteUrl} is neither ${SANDBOX} nor ${GOAL_SANDBOX}`)
  }
}

export function removeCanaries(paths) {
  for (const p of paths) rmSync(p, { force: true })
}

const inGoalSandbox = (scenario) => scenario.sandbox === GOAL_SANDBOX

export function claudeArgs({ model, sessionId, resume, addDirs = [], pluginDir = PLUGIN_DIR, scenario = {} }) {
  const goal = inGoalSandbox(scenario)
  return [
    '-p', '--plugin-dir', pluginDir, '--model', model,
    resume ? '--resume' : '--session-id', sessionId,
    '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', String(scenario.maxTurns ?? 80),
    // The person's own MCP servers and plugins would fill most of the context and differ by machine (#174).
    '--strict-mcp-config', '--setting-sources', 'project,local',
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(goal ? [] : ['--disallowedTools', ...DISALLOWED]),
    '--allowedTools', ...ALLOWED, ...(goal ? GOAL_ALLOWED : []),
  ]
}

// The reply to a question: the first unused rule that matches it, else `otherwise`.
export function pickAnswer(scenario, text, used) {
  const rules = scenario.answers ?? []
  for (let i = 0; i < rules.length; i++) {
    if (!used.has(i) && rules[i].when.test(text)) {
      used.add(i)
      return rules[i].say
    }
  }
  return scenario.otherwise ?? null
}

// A reply asks something when its prose has a question mark, which may come before
// a long list of options, or when it asks without one: "Please confirm yes/no.",
// "You can choose one of these:". Code and links are not prose: a regex or a URL has a "?".
export function asksSomething(text) {
  const prose = String(text).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/https?:\/\/\S+/g, '')
  return /\?|please confirm|\byes\s*(\/|or)\s*no\b|\bchoose\b|\bpick one\b|\bone of these\b|\b(may|can|could|shall) i\b/i.test(prose)
}

// A scenario that names fixtures the sandbox does not have yet is not run: it would fail like a plugin regression.
export function assertRunnable(scenario) {
  if (scenario.needsSandbox?.length > 0) {
    throw new Error(`${scenario.id} is not run yet: the sandbox lacks ${scenario.needsSandbox.map((f) => `\n  - ${f}`).join('')}`)
  }
}

export function dryRun(scenario, models = scenario.models ?? MODELS) {
  if (scenario.plan) {
    return [
      `${scenario.id}: ${scenario.title}`,
      `Runs ${scenario.plan.scenarios.join(', ')} with ${scenario.plan.models.join(' and ')}, three times each.`,
      ...scenario.plan.scenarios.map((id) => `  node tests/macro-loop/run.mjs ${id}`),
    ].join('\n')
  }
  const work = join(WORK_ROOT, `${scenario.id}-${models[0]}-1`)
  const repo = join(work, 'repo')
  const cwd = resolve(repo, scenario.cwd ?? '.')
  const addDirs = (scenario.addDirs ?? []).map((d) => resolve(repo, d))
  const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
  return [
    `${scenario.id}: ${scenario.title}`,
    `Models: ${models.join(', ')}; ${scenario.runs ?? 3} run(s) each.`,
    '',
    `Setup, in ${repo}:`,
    `  git clone -q https://github.com/${scenario.sandbox ?? SANDBOX} ${repo}`,
    `  remove ${CANARIES.join(' and ')}`,
    ...scenario.setup.map((c) => `  ${c}`),
    '',
    `Claude runs in ${cwd}:`,
    `  claude ${claudeArgs({ model: models[0], sessionId: '<session id>', resume: false, addDirs, scenario }).map(quote).join(' ')}`,
    '  later turns use --resume <session id> with the same flags',
    '',
    'Scripted turns:',
    ...scenario.say.map((s) => `  say: ${s}`),
    ...(scenario.answers ?? []).map((a) => `  answer ${a.when}: ${a.say}`),
    ...(scenario.otherwise ? [`  otherwise: ${scenario.otherwise}`] : []),
    '',
    `Checks: ${scenario.checks.join(', ')}`,
    ...(scenario.workBranch ? [`Branch the user names: ${scenario.workBranch}`] : []),
    `Expected verdict: ${scenario.expect.verdict ?? 'none'}${scenario.expect.measured ? ' (measured)' : ''}`,
    ...(scenario.expect.cites ? [`Measured: whether "Decide first" cites ${scenario.expect.cites}`] : []),
  ].join('\n')
}

const TRANSIENT = /timeout|timed out|TLS handshake|connection reset|ECONNRESET|HTTP 5\d\d/i
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// A network blip on `gh` is retried three times; any other failure throws at once (#297).
export function sh(cmd, args, cwd, input, { run = spawnSync, wait = pause } = {}) {
  for (let i = 0; ; i++) {
    const r = run(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 64 << 20 })
    if (r.status === 0) return r.stdout.trim()
    const out = r.stderr || r.stdout
    if (cmd !== 'gh' || i >= 3 || !TRANSIENT.test(out)) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}: ${out}`)
    wait(1000 * 2 ** i)
  }
}

const git = (cwd, ...args) => sh('git', args, cwd)
const gh = (cwd, args, input) => sh('gh', ['api', ...args], cwd, input)

// A deny rule matches only a command's start: `git -C <path> push` passed it in A2 (#57).
export function blockPushes(repo) {
  git(repo, 'config', 'url.no-push://macro-loop-suite/.pushInsteadOf', 'https://github.com/')
}

export function hashTree(dir) {
  return Object.fromEntries(listFiles(dir).map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]))
}

function listFiles(dir, root = dir) {
  return readdirSync(dir).flatMap((name) => {
    if (['.git', '.claude', 'node_modules'].includes(name)) return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? listFiles(p, root) : [relative(root, p)]
  })
}

function snapshot(scenario, repo, cwd) {
  const lines = (s) => s.split('\n').filter(Boolean)
  return {
    tree: hashTree(cwd),
    head: { branch: git(cwd, 'branch', '--show-current'), commit: git(cwd, 'rev-parse', 'HEAD') },
    branches: lines(git(repo, 'branch', '--list', '--format=%(refname:short)')),
    stash: lines(git(repo, 'stash', 'list', '--format=%gs')),
    ...(scenario.workBranch ? { tip: tipOf(repo, scenario.workBranch) } : {}),
  }
}

// The commit a branch points to, or null when there is no such branch.
function tipOf(repo, branch) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repo, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

// `git merge-base --is-ancestor` exits 0 when `old` is an ancestor of `tip`, 1 when it is not.
function isAncestor(repo, old, tip) {
  if (old == null || tip == null) return false
  const r = spawnSync('git', ['merge-base', '--is-ancestor', old, tip], { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0 && r.status !== 1) throw new Error(`git merge-base --is-ancestor ${old} ${tip} failed in ${repo}: ${r.stderr}`)
  return r.status === 0
}

// A number that answers 404 left the sandbox, as an Issue the reset just moved can still be
// listed for a moment: it is left out. Any other failure stops the run (#329).
export function githubState(repo, numbers, call = gh) {
  const read = (n) => ({
    labels: JSON.parse(call(repo, [`repos/{owner}/{repo}/issues/${n}/labels`, '--jq', '[.[].name]'])),
    comments: call(repo, ['--paginate', `repos/{owner}/{repo}/issues/${n}/comments`, '--jq', '.[] | {id, body}'])
      .split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  })
  return Object.fromEntries(numbers.flatMap((n) => {
    try {
      return [[n, read(n)]]
    } catch (e) {
      if (/HTTP 404/.test(e.message)) return []
      throw e
    }
  }))
}

// Every Issue and PR in the sandbox: a run may comment on one its scenario does not name.
function sandboxNumbers(repo) {
  return gh(repo, ['--paginate', 'repos/{owner}/{repo}/issues?state=all', '--jq', '.[].number']).split('\n').filter(Boolean).map(Number)
}

// Puts labels back and deletes comments the run added, so every run starts alike.
// A goal sandbox run keeps everything as its evidence (#301 D8).
export function restoreGithub(scenario, repo, before, after, call = gh) {
  if (inGoalSandbox(scenario)) return
  for (const n of Object.keys(before)) {
    if (!after[n]) continue
    const known = new Set(before[n].comments.map((c) => c.id))
    for (const c of after[n].comments) if (!known.has(c.id)) call(repo, ['-X', 'DELETE', `repos/{owner}/{repo}/issues/comments/${c.id}`])
    if (JSON.stringify(before[n].labels) !== JSON.stringify(after[n].labels)) {
      call(repo, ['-X', 'PUT', `repos/{owner}/{repo}/issues/${n}/labels`, '--input', '-'], JSON.stringify({ labels: before[n].labels }))
    }
  }
}

// Each goal sandbox run starts without an earlier run's Issues, which triage's duplicate search
// would find even closed (#324). They move to the archive, PRs stay closed; any failure stops the run.
const TRANSFER = 'mutation($issue: ID!, $repo: ID!) { transferIssue(input: {issueId: $issue, repositoryId: $repo}) { issue { number } } }'
export function resetGoalSandbox(scenario, repo, call = gh) {
  if (!inGoalSandbox(scenario)) return
  let archive
  try {
    archive = call(repo, [`repos/${GOAL_ARCHIVE}`, '--jq', '.node_id'])
  } catch (e) {
    throw new Error(`refusing to run: ${GOAL_ARCHIVE} is missing; create it once as tests/macro-loop/README.md says (${e.message})`)
  }
  const list = (args) => call(repo, ['--paginate', ...args]).split('\n').filter(Boolean)
  for (const n of list(['repos/{owner}/{repo}/pulls?state=open', '--jq', '.[].number'])) {
    call(repo, ['-X', 'PATCH', `repos/{owner}/{repo}/pulls/${n}`, '-f', 'state=closed'])
  }
  for (const id of list(['repos/{owner}/{repo}/issues?state=all', '--jq', '.[] | select(.pull_request == null) | .node_id'])) {
    call(repo, ['graphql', '-f', `query=${TRANSFER}`, '-f', `issue=${id}`, '-f', `repo=${archive}`])
  }
}

// One run at a time: runs share the sandbox's Issues and the canary files, and a
// run that starts deletes the canaries another run may just have written.
function lock() {
  mkdirSync(WORK_ROOT, { recursive: true })
  const path = join(WORK_ROOT, 'lock')
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    throw new Error(`another run holds ${path} (pid ${readFileSync(path, 'utf8')}); remove it if no run is in progress`)
  }
  return () => rmSync(path, { force: true })
}

function claudeTurn(args, cwd, prompt) {
  return new Promise((done, failed) => {
    const child = spawn('claude', args, { cwd })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      try {
        done(JSON.parse(out))
      } catch {
        failed(new Error(`claude exited ${code}: ${err || out}`))
      }
    })
    child.stdin.end(prompt)
  })
}

// The commit of the checkout whose plugin a run loads (#255), not the scenario repo's.
export function pluginCommit() {
  return git(ROOT, 'rev-parse', 'HEAD')
}

// `beforeRound` runs just before the reply of the rule marked `round` is sent (#302 D4).
export async function play(scenario, model, sessionId, cwd, addDirs, beforeRound) {
  const log = []
  let resume = false
  const send = async (text) => {
    const start = Date.now()
    const r = await claudeTurn(claudeArgs({ model, sessionId, resume, addDirs, scenario }), cwd, text)
    const ms = Date.now() - start
    resume = true
    log.push({ said: text, result: r.result, isError: r.is_error, denials: r.permission_denials ?? [], cost: r.total_cost_usd, turns: r.num_turns, ms })
    return r.result ?? ''
  }
  let last = ''
  for (const text of scenario.say) last = await send(text)
  const used = new Set()
  for (let i = 0; i < (scenario.maxAnswers ?? MAX_ANSWERS) && asksSomething(last); i++) {
    const rules = used.size
    const reply = pickAnswer(scenario, last, used)
    if (reply == null) break
    if (reply === scenario.answers?.find((a) => a.round)?.say) await beforeRound?.()
    const asked = last
    last = await send(reply)
    // No rule matched: the run needed a reply the script did not plan for.
    if (used.size === rules) log.at(-1).extra = asked
  }
  return log
}

const trust = (repo, ...args) => JSON.parse(sh('node', [join(PLUGIN_DIR, 'scripts/trust.mjs'), ...args], repo))

// The Issues and PRs this run created, its tracking Issue (undefined when it created none, #301 D7)
// and that Issue's children. Issues from earlier runs are left out (D8).
function goalTracking(repo, numbersBefore) {
  const known = new Set(numbersBefore)
  const created = gh(repo, ['--paginate', 'repos/{owner}/{repo}/issues?state=all', '--jq', '.[] | {number, login: .user.login, body, pr: (.pull_request != null)}'])
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((i) => !known.has(i.number))
  const trusted = new Set(trust(repo).trusted)
  const tracking = created.find((i) => !i.pr && trusted.has(i.login.toLowerCase()) && String(i.body ?? '').startsWith('<!-- macro-loop:goal -->'))
  return { created, tracking, childNumbers: tracking ? [...tracking.body.matchAll(/^\s*- \[[ xX]\] #(\d+)/gm)].map((m) => Number(m[1])) : [] }
}

// The tracking Issue's children with their labels and comments, as `heldDoesNotStopOthers` takes them.
function goalChildState(repo, numbersBefore) {
  const state = githubState(repo, goalTracking(repo, numbersBefore).childNumbers)
  return Object.entries(state).map(([n, s]) => ({ number: Number(n), ...s }))
}

// Each child of the tracking Issue with its labels and the PR the run opened for it, and the
// tracking Issue's queue; `children` is null when the run created no tracking Issue.
function goalChildren(repo, numbersBefore) {
  const { created, tracking, childNumbers } = goalTracking(repo, numbersBefore)
  if (!tracking) return { children: null, queue: [] }
  const prs = created.filter((i) => i.pr).map((i) => {
    const { state, draft } = JSON.parse(gh(repo, [`repos/{owner}/{repo}/pulls/${i.number}`, '--jq', '{state, draft}']))
    return { number: i.number, state, draft, verdict: trust(repo, '--pr', String(i.number)).pr.lastVerdictResult, closes: closesAll(i.body) }
  })
  const labels = githubState(repo, childNumbers)
  const children = childNumbers.map((number) => {
    const pr = prs.find((p) => p.closes.includes(number))
    return { number, labels: labels[number]?.labels ?? [], pr: pr ? { number: pr.number, state: pr.state, draft: pr.draft, verdict: pr.verdict } : null }
  })
  return { children, queue: trust(repo, '--issue', String(tracking.number)).issue.queue ?? [] }
}

async function runOnce(scenario, model, n, outDir) {
  const start = Date.now()
  const commit = pluginCommit()
  const work = join(WORK_ROOT, `${scenario.id}-${model}-${n}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const repo = join(work, 'repo')
  git(work, 'clone', '-q', `https://github.com/${scenario.sandbox ?? SANDBOX}`, repo)
  assertSandbox(git(repo, 'remote', 'get-url', 'origin'))
  resetGoalSandbox(scenario, repo)
  if (!inGoalSandbox(scenario)) blockPushes(repo)
  removeCanaries(CANARIES)
  for (const command of scenario.setup) sh('bash', ['-c', command], repo)
  const cwd = resolve(repo, scenario.cwd ?? '.')
  const addDirs = (scenario.addDirs ?? []).map((d) => resolve(repo, d))
  const numbers = sandboxNumbers(repo)
  const before = snapshot(scenario, repo, cwd)
  const githubBefore = githubState(repo, numbers)
  const sessionId = randomUUID()
  let turns
  let githubAfter
  let childrenBeforeRound = []
  try {
    turns = await play(scenario, model, sessionId, cwd, addDirs, () => {
      if (inGoalSandbox(scenario)) childrenBeforeRound = goalChildState(repo, numbers)
    })
  } finally {
    githubAfter = githubState(repo, numbers)
    restoreGithub(scenario, repo, githubBefore, githubAfter)
  }
  const after = snapshot(scenario, repo, cwd)
  const known = new Set((githubBefore[scenario.pr]?.comments ?? []).map((c) => c.id))
  const comment = scenario.pr
    ? githubAfter[scenario.pr].comments.find((c) => !known.has(c.id) && c.body.startsWith('<!-- macro-loop:verify'))?.body ?? null
    : null
  const transcripts = findProjectDir(sessionId)
  const obs = {
    calls: loadCalls(transcripts, sessionId),
    checkout: cwd,
    before,
    after,
    comment,
    texts: turns.map((t) => t.result ?? ''),
    waits: turns.map((t) => t.result ?? '').filter(asksSomething),
    children: inGoalSandbox(scenario) ? childrenBeforeRound : (scenario.children ?? []).map((n) => ({ number: n, ...githubAfter[n] })),
    comments: githubAfter[scenario.tracking]?.comments ?? [],
    canaries: Object.fromEntries((scenario.canaries ?? []).map((p) => [p, existsSync(p)])),
    tips: scenario.workBranch && { before: before.tip, after: after.tip, ancestor: isAncestor(repo, before.tip, after.tip) },
    gaps: inGoalSandbox(scenario)
      ? goalGaps({
          denials: turns.flatMap((t) => t.denials),
          extraReplies: turns.filter((t) => t.extra).map((t) => ({ asked: t.extra, said: t.said })),
          ...goalChildren(repo, numbers),
          held: scenario.held,
        })
      : [],
  }
  const { safety, verdict, cites, noVerdict } = evaluate(scenario, obs)
  const usage = loadUsage(transcripts, sessionId)
  rmSync(work, { recursive: true, force: true })
  const result = { scenario: scenario.id, model, run: n, commit, ms: Date.now() - start, sessionId, cwd, transcripts, turns, usage, comment, safety, verdict, cites, noVerdict, expected: scenario.expect, ...(inGoalSandbox(scenario) ? { gaps: obs.gaps } : {}) }
  writeFileSync(join(outDir, `${scenario.id}-${model}-${n}.json`), JSON.stringify(result, null, 2))
  return result
}

async function runScenario(id, models, runs) {
  const scenario = findScenario(id)
  assertRunnable(scenario)
  if (scenario.plan) {
    const all = []
    for (const sub of scenario.plan.scenarios) all.push(...(await runScenario(sub, models ?? scenario.plan.models, runs)))
    return all
  }
  const outDir = join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${scenario.id}`)
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const model of models ?? scenario.models ?? MODELS) {
    for (let n = 1; n <= (runs ?? scenario.runs ?? 3); n++) {
      const r = await runOnce(scenario, model, n, outDir)
      console.log(`${r.scenario} ${model} run ${n}: verdict ${r.verdict ?? 'none'}; ${Object.entries(r.safety).map(([k, v]) => `${k} ${v.pass ? 'ok' : 'FAIL'}`).join(', ')}`)
      results.push(r)
    }
  }
  writeFileSync(join(outDir, 'report.txt'), `${formatReport(aggregate(results))}\n`)
  return results
}

// M7's claim reaches the verifier through the branch's log (#280 D8); every other seed says what it is.
const SEED_MESSAGES = { m7: 'AC1–AC3 met' }
export const seedMessage = (name) => SEED_MESSAGES[name] ?? `Seed ${name}`

// Puts each patch in seeds/ on its own `seed/<name>` branch of the sandbox, cut from main.
function seedSandbox() {
  const work = join(WORK_ROOT, 'seed')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const repo = join(work, 'repo')
  git(work, 'clone', '-q', `https://github.com/${SANDBOX}`, repo)
  assertSandbox(git(repo, 'remote', 'get-url', 'origin'))
  for (const file of readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.patch')).sort()) {
    const name = file.replace(/\.patch$/, '')
    git(repo, 'checkout', '-q', '-B', `seed/${name}`, 'origin/main')
    git(repo, 'apply', '--index', join(SEEDS_DIR, file))
    git(repo, 'commit', '-q', '-m', seedMessage(name))
    git(repo, 'push', '-q', '--force-with-lease', 'origin', `seed/${name}`)
    console.log(`seed/${name} pushed`)
  }
  rmSync(work, { recursive: true, force: true })
}

// Rescores on Opus against the committed baseline and rewrites it (#200). The baseline
// names HEAD as the measured commit, so the verifier's files must be committed.
async function rescoreBaseline(resumeDir) {
  const dirty = git(ROOT, 'status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3)).filter(isVerifierPath)
  if (dirty.length > 0) throw new Error(`commit these first, the baseline names HEAD: ${dirty.join(', ')}`)
  const commit = git(ROOT, 'rev-parse', 'HEAD')
  const file = join(ROOT, BASELINE)
  const { rows } = parseBaseline(existsSync(file) ? readFileSync(file, 'utf8') : '')
  const outDir = resumeDir ? resolve(resumeDir) : join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-rescore`)
  mkdirSync(outDir, { recursive: true })
  const done = new Map()
  // A failed session is tried again from a fresh clone; only the attempt that finished counts.
  const attempt = async (scenario, n) => {
    const r = await runOnce(scenario, 'opus', n, outDir)
    if (r.turns.some((t) => t.isError)) throw new Error(`${scenario.id} run ${n}: the session ended in an error`)
    return r
  }
  const play = async (scenario, times) => {
    const runs = []
    for (let i = 0; i < times; i++) {
      const n = (done.get(scenario.id) ?? 0) + 1
      done.set(scenario.id, n)
      const r = await retrying(() => attempt(scenario, n))
      console.log(`${r.scenario} opus run ${n}: verdict ${r.verdict ?? 'none'}; safety ${Object.values(r.safety).every((c) => c.pass) ? 'ok' : 'FAIL'}${r.cites == null ? '' : `; "Decide first" cites ${scenario.expect.cites}: ${r.cites ? 'yes' : 'no'}`}`)
      runs.push(r)
    }
    return runs
  }
  const saved = loadRows(outDir)
  const written = await rescoreToFile(file, commit, rescoreSet(), rows, play, { saved, onRow: (row) => saveRow(outDir, row) })
  console.log(`\n${readFileSync(file, 'utf8')}`)
  const byId = new Map(written.map((r) => [r.id, r]))
  console.log(formatAccuracy(confusion(byId, rescoreSet())))
  console.log(`\n${formatPass3(byId, rescoreSet())}`)
}

// Plays every mutant once, held out included, then prints the kill report (#257 D5).
// `runOne(scenario)` plays one run and resolves to its result.
export async function runMutants(runOne, print = console.log) {
  const set = mutants()
  const results = []
  for (const s of set) results.push(await runOne(s))
  const report = killReport(SPEC_1_CRITERIA, set, results)
  print(`Kill report for #1:\n${report}`)
  return report
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { list: { type: 'boolean' }, 'dry-run': { type: 'string' }, seed: { type: 'boolean' }, rescore: { type: 'boolean' }, mutants: { type: 'boolean' }, resume: { type: 'string' }, model: { type: 'string' }, runs: { type: 'string' } },
  })
  const models = values.model ? [values.model] : undefined
  if (values.list) return console.log(scenarios.map((s) => `${s.id}  ${s.title}`).join('\n'))
  if (values['dry-run']) return console.log(dryRun(findScenario(values['dry-run']), models))
  const named = !values.seed && !values.rescore && !values.mutants
  if (named && positionals.length !== 1) {
    throw new Error('usage: run.mjs --list | --dry-run <ID> | --seed | --rescore | --mutants | <ID> [--model m] [--runs n]')
  }
  if (named) assertRunnable(findScenario(positionals[0]))
  const unlock = lock()
  try {
    if (values.seed) return seedSandbox()
    if (values.rescore) return await rescoreBaseline(values.resume)
    if (values.mutants) {
      const outDir = join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-mutants`)
      mkdirSync(outDir, { recursive: true })
      return await runMutants((s) => runOnce(s, 'opus', 1, outDir))
    }
    const results = await runScenario(positionals[0], models, values.runs && Number(values.runs))
    console.log(`\n${formatReport(aggregate(results))}`)
  } finally {
    unlock()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
