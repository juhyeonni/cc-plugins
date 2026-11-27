import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-suite-rescore.mjs')
const { check } = await import(pathToFileURL(SCRIPT).href)
const { parseBaseline } = await import(pathToFileURL(join(ROOT, 'tests', 'macro-loop', 'rescore.mjs')).href)

const VERIFIER = 'plugins/macro-loop/agents/verifier.md'
const BASELINE = 'tests/macro-loop/baseline.txt'
const baseline = (rows = 'C0 runs=1 verdict=1 safety=1 regression=no') => parseBaseline(`commit abc1234\n${rows}\n`)

test('passes a PR that touches no verifier path, with an empty body', () => {
  assert.equal(check({ touched: ['README.md', 'plugins/macro-loop/skills/spec/SKILL.md'], body: '' }).ok, true)
})

test('fails a verifier change with no baseline and no skip line, naming the paths', () => {
  const r = check({ touched: [VERIFIER, 'plugins/macro-loop/scripts/verifier-flags.mjs', 'README.md'], body: '' })
  assert.equal(r.ok, false)
  assert.match(r.message, /agents\/verifier\.md/)
  assert.match(r.message, /verifier-flags\.mjs/)
  assert.doesNotMatch(r.message, /README/)
})

test('every verifier path in the spec triggers the check', () => {
  for (const p of [
    VERIFIER,
    'plugins/macro-loop/scripts/verdict.mjs',
    'plugins/macro-loop/scripts/verifier-report.mjs',
    'plugins/macro-loop/scripts/identifier-lines.mjs',
    'plugins/macro-loop/hooks/hooks.json',
    'plugins/macro-loop/skills/verify/SKILL.md',
    'tests/macro-loop/seeds/c0.patch',
    'tests/macro-loop/scenarios.mjs',
  ]) {
    assert.equal(check({ touched: [p] }).ok, false, p)
  }
})

test('passes with a skip line that has a reason, fails when the reason is empty', () => {
  assert.equal(check({ touched: [VERIFIER], body: 'Fixes a typo.\r\nSuite: skipped — comment-only change\r\n' }).ok, true)
  assert.equal(check({ touched: [VERIFIER], body: 'Suite: skipped — ' }).ok, false)
  assert.equal(check({ touched: [VERIFIER], body: 'Suite: skipped —' }).ok, false)
})

test('accepts a colon, parentheses or a hyphen in place of the dash, and still needs a reason (#317)', () => {
  for (const body of ['Suite: skipped: x', 'Suite: skipped (x)', 'Suite: skipped — x', 'Suite: skipped - x', 'Suite: skipped -- x']) {
    const r = check({ touched: [VERIFIER], body })
    assert.equal(r.ok, true, body)
    assert.equal(r.message, 'rescore skipped: x', body)
  }
  for (const body of ['Suite: skipped:', 'Suite: skipped ()', 'Suite: skipped —', 'Suite: skipped ( )\nmore']) {
    const r = check({ touched: [VERIFIER], body })
    assert.equal(r.ok, false, body)
    assert.match(r.message, /has no reason/, body)
  }
})

test('passes an updated baseline when no verifier path changed since its commit, fails when one did', () => {
  const touched = [VERIFIER, BASELINE]
  assert.equal(check({ touched, baseline: baseline(), inHistory: true, changedSince: [] }).ok, true)
  const r = check({ touched, baseline: baseline(), inHistory: true, changedSince: [VERIFIER] })
  assert.equal(r.ok, false)
  assert.match(r.message, /agents\/verifier\.md/)
})

test('fails when the recorded commit is not in the history, and says to rescore', () => {
  const r = check({ touched: [VERIFIER, BASELINE], baseline: baseline(), inHistory: false })
  assert.equal(r.ok, false)
  assert.match(r.message, /abc1234/)
  assert.match(r.message, /[Rr]escore/)
})

test('a confirmed regression needs an accepted-regression line', () => {
  const b = baseline('C0 runs=4 verdict=1 safety=4 regression=yes\nC1 runs=4 verdict=2 safety=3 regression=yes\nC2 runs=1 verdict=1 safety=1 regression=no')
  const touched = [VERIFIER, BASELINE]
  const one = check({ touched, baseline: b, inHistory: true, body: 'Suite: accepted regression — C0: flaky seed' })
  assert.equal(one.ok, false)
  assert.match(one.message, /C1/)
  assert.doesNotMatch(one.message, /C0|C2/)
  const both = check({ touched, baseline: b, inHistory: true, body: 'Suite: accepted regression — C0: flaky seed\nSuite: accepted regression — C1: tracked in #999' })
  assert.equal(both.ok, true)
})

test('the workflow runs on body edits and reads the body only through an environment variable', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(yml, /types: \[[^\]]*\bedited\b/)
  const uses = yml.split('\n').filter((l) => l.includes('pull_request.body'))
  assert.ok(uses.length > 0)
  for (const line of uses) assert.match(line, /^\s+(?!run:)[A-Z_]+: \$\{\{ github\.event\.pull_request\.body \}\}$/)
})

// The git side, end to end, in a throwaway repo.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'suite-rescore-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' }).stdout.trim()
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (msg) => {
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q', '-b', 'main')
  write('README.md', 'x\n')
  commit('base')
  const run = (head, body = '') =>
    spawnSync('node', [SCRIPT, 'main', head], { cwd: dir, encoding: 'utf8', env: { ...process.env, PR_BODY: body } })
  return { git, write, commit, run }
}

test('end to end: a baseline at the measured commit passes; a later verifier change or a foreign commit fails', () => {
  const r = repo()
  r.git('checkout', '-qb', 'pr')
  r.write(VERIFIER, 'v2\n')
  const measured = r.commit('change verifier')
  r.write(BASELINE, `commit ${measured}\nC0 runs=3 verdict=3 safety=3 regression=no\n`)
  const head = r.commit('baseline')
  assert.equal(r.run(head).status, 0, r.run(head).stdout)

  r.write(VERIFIER, 'v3\n')
  const later = r.commit('change again')
  const changed = r.run(later)
  assert.equal(changed.status, 1)
  assert.match(changed.stdout, /agents\/verifier\.md/)

  r.write(BASELINE, `commit ${'f'.repeat(40)}\nC0 runs=3 verdict=3 safety=3 regression=no\n`)
  const foreign = r.run(r.commit('foreign baseline'))
  assert.equal(foreign.status, 1)
  assert.match(foreign.stdout, /not in this branch's history/)
})

test('#214 AC14: a flaky row without regression=yes passes; a regression=yes row still needs its accepted line', () => {
  const args = { touched: [VERIFIER, BASELINE], inHistory: true }
  const flaky = baseline('C0 runs=3 verdict=2 safety=3 regression=no flaky=yes noverdict=1')
  assert.equal(check({ ...args, baseline: flaky }).ok, true)
  const regressed = baseline('C0 runs=4 verdict=1 safety=3 regression=yes flaky=yes noverdict=0')
  assert.equal(check({ ...args, baseline: regressed }).ok, false)
  assert.equal(check({ ...args, baseline: regressed, body: 'Suite: accepted regression — C0: known' }).ok, true)
})

const MANIFEST = 'plugins/macro-loop/.claude-plugin/plugin.json'
const manifest = (version, extra = {}) => JSON.stringify({ name: 'macro-loop', version, ...extra }) + '\n'

// main: the verifier measured at `measured` and a baseline naming it; `after` changes the verifier on main after that.
function releaseRepo({ after = false } = {}) {
  const r = repo()
  r.write(MANIFEST, manifest('1.0.0'))
  r.write(VERIFIER, 'v1\n')
  const measured = r.commit('verifier')
  r.write(BASELINE, `commit ${measured}\nC0 runs=3 verdict=3 safety=3 regression=no\n`)
  r.commit('baseline')
  if (after) {
    r.write(VERIFIER, 'v2\n')
    r.commit('unmeasured verifier change')
  }
  r.git('checkout', '-qb', 'pr')
  return r
}

test('#278 AC1: a version bump fails when a verifier path changed after the baseline, even with a skip line', () => {
  const r = releaseRepo({ after: true })
  r.write(MANIFEST, manifest('1.1.0'))
  const out = r.run(r.commit('release'), 'Suite: skipped — per-PR skips already given')
  assert.equal(out.status, 1, out.stdout)
  assert.match(out.stdout, /agents\/verifier\.md/)
  assert.match(out.stdout, /node tests\/macro-loop\/run\.mjs --rescore/)
})

test('#278 AC2: a version bump with no verifier change since the baseline passes with an empty body', () => {
  const r = releaseRepo()
  r.write(MANIFEST, manifest('1.1.0'))
  const out = r.run(r.commit('release'))
  assert.equal(out.status, 0, out.stdout)
})

test('#278 AC2: a manifest edit that keeps the version is judged as today', () => {
  const r = releaseRepo({ after: true })
  r.write(MANIFEST, manifest('1.0.0', { description: 'new' }))
  const out = r.run(r.commit('describe'))
  assert.equal(out.status, 0, out.stdout)
  assert.match(out.stdout, /no verifier path changed/)
})

test('#278 AC3: a version bump whose baseline commit is not in the history fails and says to rescore', () => {
  const r = releaseRepo()
  r.write(MANIFEST, manifest('1.1.0'))
  r.write(BASELINE, `commit ${'f'.repeat(40)}\nC0 runs=3 verdict=3 safety=3 regression=no\n`)
  const out = r.run(r.commit('release'))
  assert.equal(out.status, 1, out.stdout)
  assert.match(out.stdout, /[Rr]escore/)
})

test('#278 D4: a release whose baseline names no commit fails and says to rescore', () => {
  const r = check({ touched: [MANIFEST], release: true, baseline: parseBaseline('C0 runs=1 verdict=1 safety=1 regression=no\n') })
  assert.equal(r.ok, false)
  assert.match(r.message, /[Rr]escore/)
})
