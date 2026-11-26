import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/macro-loop/scripts')
const GUARDED = ['trust', 'execute', 'outcomes', 'stage', 'status', 'verdict', 'verifier-report']

// A stand-in for `gh` that answers trust.mjs's three calls and fails every other one.
const STUB = `#!/usr/bin/env node
const key = process.argv.slice(2).join(' ')
const answers = {
  'api user': { login: 'Carol' },
  'api repos/{owner}/{repo}': { owner: { login: 'JuHyeonni', type: 'User' }, default_branch: 'main' },
  'api repos/{owner}/{repo}/contents/.github/macro-loop.json': { content: Buffer.from('{}').toString('base64'), encoding: 'base64' },
}
if (!answers[key]) { process.stderr.write('stub: unexpected call: gh ' + key + '\\n'); process.exit(99) }
process.stdout.write(JSON.stringify(answers[key]))
`

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'symlink-'))
  mkdirSync(join(tmp, 'bin'))
  writeFileSync(join(tmp, 'bin', 'gh'), STUB)
  chmodSync(join(tmp, 'bin', 'gh'), 0o755)
  symlinkSync(SCRIPTS, join(tmp, 'scripts'))
  mkdirSync(join(tmp, 'cwd'))
  const env = { PATH: `${join(tmp, 'bin')}:${dirname(process.execPath)}`, HOME: tmp }
  const run = (script, args = [], input = '') =>
    spawnSync(process.execPath, [script, ...args], { cwd: join(tmp, 'cwd'), env, input, encoding: 'utf8' })
  return { linked: join(tmp, 'scripts'), run }
}

test('AC1: trust.mjs through a symlinked scripts directory prints the same JSON as through its real path', () => {
  const { linked, run } = setup()
  const real = run(join(SCRIPTS, 'trust.mjs'))
  const viaLink = run(join(linked, 'trust.mjs'))
  assert.equal(real.status, 0, real.stderr)
  assert.ok(JSON.parse(real.stdout).trusted.includes('carol'))
  assert.equal(viaLink.status, 0, viaLink.stderr)
  assert.equal(viaLink.stdout, real.stdout)
})

for (const name of GUARDED) {
  test(`AC2, AC3: ${name}.mjs fails the same way through a symlink as through its real path`, () => {
    const { linked, run } = setup()
    const args = name === 'status' || name === 'verifier-report' ? [] : ['--bogus']
    const input = name === 'verifier-report' ? 'not json' : ''
    const real = run(join(SCRIPTS, `${name}.mjs`), args, input)
    const viaLink = run(join(linked, `${name}.mjs`), args, input)
    assert.notEqual(real.status, 0)
    assert.match(real.stderr, new RegExp(`^${name}\\.mjs: `))
    assert.equal(viaLink.status, real.status)
    assert.equal(viaLink.stderr, real.stderr)
    assert.equal(viaLink.stdout, '')
  })
}

test('AC4: importing every guarded script, from a module file and from node -e, prints nothing and throws nothing', () => {
  const imports = GUARDED.map((n) => `await import(${JSON.stringify(join(SCRIPTS, `${n}.mjs`))})`).join('\n')
  const tmp = mkdtempSync(join(tmpdir(), 'symlink-import-'))
  writeFileSync(join(tmp, 'importer.mjs'), imports)
  for (const args of [[join(tmp, 'importer.mjs')], ['--input-type=module', '-e', imports]]) {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', input: '' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
  }
})
