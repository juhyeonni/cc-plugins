// Runs the macro-loop scenario suite against the sandbox repo (#28).
//
//   node tests/macro-loop/run.mjs --list
//   node tests/macro-loop/run.mjs --dry-run <ID> [--model opus]
//   node tests/macro-loop/run.mjs --seed
//   node tests/macro-loop/run.mjs <ID> [--model opus|haiku|sonnet] [--runs 3]
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { aggregate, evaluate, formatReport } from './checks.mjs'
import { loadCalls, projectDir } from './transcript.mjs'
import { CANARIES, SANDBOX, findScenario, scenarios } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = resolve(here, '../../plugins/macro-loop')
const SEEDS_DIR = join(here, 'seeds')
const RESULTS_DIR = join(here, 'results')
const WORK_ROOT = join(tmpdir(), 'macro-loop-suite')
const MODELS = ['opus', 'haiku']
const MAX_ANSWERS = 4

// Pushing and opening PRs are blocked: a blocked push is the user declining it.
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
  if (!/^(https:\/\/github\.com\/|git@github\.com:)juhyeonni\/macro-loop-sandbox$/.test(normalized)) {
    throw new Error(`refusing to run: ${remoteUrl} is not the sandbox ${SANDBOX}`)
  }
}

export function removeCanaries(paths) {
  for (const p of paths) rmSync(p, { force: true })
}

export function claudeArgs({ model, sessionId, resume, addDirs = [], pluginDir = PLUGIN_DIR }) {
  return [
    '-p', '--plugin-dir', pluginDir, '--model', model,
    resume ? '--resume' : '--session-id', sessionId,
    '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '80',
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    '--disallowedTools', ...DISALLOWED,
    '--allowedTools', ...ALLOWED,
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
  return /\?|please confirm|\byes\s*(\/|or)\s*no\b|\bchoose\b|\bpick one\b|\bone of these\b/i.test(prose)
}

export function dryRun(scenario, models = MODELS) {
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
    `Models: ${models.join(', ')}; three runs each.`,
    '',
    `Setup, in ${repo}:`,
    `  git clone -q https://github.com/${SANDBOX} ${repo}`,
    `  remove ${CANARIES.join(' and ')}`,
    ...scenario.setup.map((c) => `  ${c}`),
    '',
    `Claude runs in ${cwd}:`,
    `  claude ${claudeArgs({ model: models[0], sessionId: '<session id>', resume: false, addDirs }).map(quote).join(' ')}`,
    '  later turns use --resume <session id> with the same flags',
    '',
    'Scripted turns:',
    ...scenario.say.map((s) => `  say: ${s}`),
    ...(scenario.answers ?? []).map((a) => `  answer ${a.when}: ${a.say}`),
    ...(scenario.otherwise ? [`  otherwise: ${scenario.otherwise}`] : []),
    ...(scenario.afterFirstStash ? ['', `After the first stash entry appears: ${scenario.afterFirstStash}`] : []),
    '',
    `Checks: ${scenario.checks.join(', ')}`,
    `Expected verdict: ${scenario.expect.verdict ?? 'none'}${scenario.expect.measured ? ' (measured)' : ''}`,
  ].join('\n')
}

function sh(cmd, args, cwd, input) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

const git = (cwd, ...args) => sh('git', args, cwd)
const gh = (cwd, args, input) => sh('gh', ['api', ...args], cwd, input)

export function hashTree(dir, only) {
  const files = only ?? listFiles(dir)
  return Object.fromEntries(
    files.map((f) => [f, existsSync(join(dir, f)) ? createHash('sha256').update(readFileSync(join(dir, f))).digest('hex') : null]),
  )
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
    tree: hashTree(cwd, scenario.watch),
    head: { branch: git(cwd, 'branch', '--show-current'), commit: git(cwd, 'rev-parse', 'HEAD') },
    branches: lines(git(repo, 'branch', '--list', '--format=%(refname:short)')),
    stash: lines(git(repo, 'stash', 'list', '--format=%gs')),
  }
}

function githubState(repo, numbers) {
  return Object.fromEntries(
    numbers.map((n) => [
      n,
      {
        labels: JSON.parse(gh(repo, [`repos/{owner}/{repo}/issues/${n}/labels`, '--jq', '[.[].name]'])),
        comments: gh(repo, ['--paginate', `repos/{owner}/{repo}/issues/${n}/comments`, '--jq', '.[] | {id, body}'])
          .split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      },
    ]),
  )
}

// Every Issue and PR in the sandbox: a run may comment on one its scenario does not name.
function sandboxNumbers(repo) {
  return gh(repo, ['--paginate', 'repos/{owner}/{repo}/issues?state=all', '--jq', '.[].number']).split('\n').filter(Boolean).map(Number)
}

// Puts labels back and deletes comments the run added, so every run starts alike.
function restoreGithub(repo, before, after) {
  for (const n of Object.keys(before)) {
    const known = new Set(before[n].comments.map((c) => c.id))
    for (const c of after[n].comments) if (!known.has(c.id)) gh(repo, ['-X', 'DELETE', `repos/{owner}/{repo}/issues/comments/${c.id}`])
    if (JSON.stringify(before[n].labels) !== JSON.stringify(after[n].labels)) {
      gh(repo, ['-X', 'PUT', `repos/{owner}/{repo}/issues/${n}/labels`, '--input', '-'], JSON.stringify({ labels: before[n].labels }))
    }
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

// Fires `command` once, as soon as the stash has its first entry.
function watchStash(repo, command) {
  let fired = false
  const timer = setInterval(() => {
    if (fired) return
    const r = spawnSync('git', ['stash', 'list'], { cwd: repo, encoding: 'utf8' })
    if (r.stdout.trim() !== '') {
      fired = true
      spawnSync('bash', ['-c', command], { cwd: repo })
    }
  }, 1000)
  return () => clearInterval(timer)
}

async function play(scenario, model, sessionId, cwd, repo, addDirs) {
  const log = []
  let resume = false
  const send = async (text) => {
    const r = await claudeTurn(claudeArgs({ model, sessionId, resume, addDirs }), cwd, text)
    resume = true
    log.push({ said: text, result: r.result, isError: r.is_error, denials: (r.permission_denials ?? []).length })
    return r.result ?? ''
  }
  const stop = scenario.afterFirstStash ? watchStash(repo, scenario.afterFirstStash) : () => {}
  try {
    let last = ''
    for (const text of scenario.say) last = await send(text)
    const used = new Set()
    for (let i = 0; i < MAX_ANSWERS && asksSomething(last); i++) {
      const reply = pickAnswer(scenario, last, used)
      if (reply == null) break
      last = await send(reply)
    }
    return log
  } finally {
    stop()
  }
}

async function runOnce(scenario, model, n, outDir) {
  const work = join(WORK_ROOT, `${scenario.id}-${model}-${n}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const repo = join(work, 'repo')
  git(work, 'clone', '-q', `https://github.com/${SANDBOX}`, repo)
  assertSandbox(git(repo, 'remote', 'get-url', 'origin'))
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
  try {
    turns = await play(scenario, model, sessionId, cwd, repo, addDirs)
  } finally {
    githubAfter = githubState(repo, numbers)
    restoreGithub(repo, githubBefore, githubAfter)
  }
  const after = snapshot(scenario, repo, cwd)
  const known = new Set((githubBefore[scenario.pr]?.comments ?? []).map((c) => c.id))
  const comment = scenario.pr
    ? githubAfter[scenario.pr].comments.find((c) => !known.has(c.id) && c.body.startsWith('<!-- macro-loop:verify'))?.body ?? null
    : null
  const obs = {
    calls: loadCalls(projectDir(cwd), sessionId),
    checkout: cwd,
    before,
    after,
    comment,
    texts: turns.map((t) => t.result ?? ''),
    canaries: Object.fromEntries((scenario.canaries ?? []).map((p) => [p, existsSync(p)])),
  }
  const { safety, verdict } = evaluate(scenario, obs)
  const result = { scenario: scenario.id, model, run: n, sessionId, cwd, transcripts: projectDir(cwd), turns, comment, safety, verdict, expected: scenario.expect }
  writeFileSync(join(outDir, `${scenario.id}-${model}-${n}.json`), JSON.stringify(result, null, 2))
  rmSync(work, { recursive: true, force: true })
  return result
}

async function runScenario(id, models, runs) {
  const scenario = findScenario(id)
  if (scenario.plan) {
    const all = []
    for (const sub of scenario.plan.scenarios) all.push(...(await runScenario(sub, models ?? scenario.plan.models, runs)))
    return all
  }
  const outDir = join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${scenario.id}`)
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const model of models ?? MODELS) {
    for (let n = 1; n <= runs; n++) {
      const r = await runOnce(scenario, model, n, outDir)
      console.log(`${r.scenario} ${model} run ${n}: verdict ${r.verdict ?? 'none'}; ${Object.entries(r.safety).map(([k, v]) => `${k} ${v.pass ? 'ok' : 'FAIL'}`).join(', ')}`)
      results.push(r)
    }
  }
  writeFileSync(join(outDir, 'report.txt'), `${formatReport(aggregate(results))}\n`)
  return results
}

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
    git(repo, 'apply', join(SEEDS_DIR, file))
    git(repo, 'commit', '-q', '-am', `Seed ${name}`)
    git(repo, 'push', '-q', '--force-with-lease', 'origin', `seed/${name}`)
    console.log(`seed/${name} pushed`)
  }
  rmSync(work, { recursive: true, force: true })
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { list: { type: 'boolean' }, 'dry-run': { type: 'string' }, seed: { type: 'boolean' }, model: { type: 'string' }, runs: { type: 'string' } },
  })
  const models = values.model ? [values.model] : undefined
  if (values.list) return console.log(scenarios.map((s) => `${s.id}  ${s.title}`).join('\n'))
  if (values['dry-run']) return console.log(dryRun(findScenario(values['dry-run']), models ?? MODELS))
  if (!values.seed && positionals.length !== 1) throw new Error('usage: run.mjs --list | --dry-run <ID> | --seed | <ID> [--model m] [--runs n]')
  const unlock = lock()
  try {
    if (values.seed) return seedSandbox()
    const results = await runScenario(positionals[0], models, Number(values.runs ?? 3))
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
