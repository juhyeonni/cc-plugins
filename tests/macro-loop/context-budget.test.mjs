// Each skill's and the verifier's load set (budget.mjs) held to a budget, in characters (#175).
// A PR that shrinks a skill lowers its budget here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSet, overBudget } from './budget.mjs'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/macro-loop')

const BUDGETS = {
  'agents/verifier.md': 13000,
  'skills/execute/SKILL.md': 20500,
  'skills/goal/SKILL.md': 20500,
  'skills/grilling/SKILL.md': 20500,
  'skills/implement/SKILL.md': 23000,
  'skills/init/SKILL.md': 19500,
  'skills/next/SKILL.md': 21000,
  'skills/open-pr/SKILL.md': 25500,
  'skills/research/SKILL.md': 23000,
  'skills/spec/SKILL.md': 30000,
  'skills/status/SKILL.md': 17500,
  'skills/triage/SKILL.md': 25000,
  'skills/ui-placement/SKILL.md': 19000,
  'skills/verify/SKILL.md': 26000,
}

function fakePlugin(skillText) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-'))
  mkdirSync(join(root, 'skills/a'), { recursive: true })
  mkdirSync(join(root, 'agents'))
  mkdirSync(join(root, 'reference'))
  writeFileSync(join(root, 'skills/a/SKILL.md'), skillText)
  writeFileSync(join(root, 'skills/a/RULES.md'), 'r'.repeat(10))
  writeFileSync(join(root, 'reference/github.md'), 'g'.repeat(100))
  return root
}

test('a load set is the file, the references it names and the files it links', () => {
  const root = fakePlugin('Read `${CLAUDE_PLUGIN_ROOT}/reference/github.md`, then [RULES](RULES.md).')
  assert.deepEqual(loadSet(root, 'skills/a/SKILL.md'), ['skills/a/SKILL.md', 'reference/github.md', 'skills/a/RULES.md'])
})

test('every skill and the verifier is within its budget', () => {
  assert.deepEqual(overBudget(PLUGIN, BUDGETS), [])
})

test('a load set over its budget is named, with how far over', () => {
  const root = fakePlugin('x'.repeat(40) + ' [RULES](RULES.md)')
  assert.deepEqual(overBudget(root, { 'skills/a/SKILL.md': 50 }), ['skills/a/SKILL.md loads 68 characters, 18 over its budget of 50'])
})

test('a skill or agent file without a budget fails, by name', () => {
  const root = fakePlugin('hi')
  writeFileSync(join(root, 'agents/helper.md'), 'agent')
  assert.deepEqual(overBudget(root, { 'skills/a/SKILL.md': 100 }), ['agents/helper.md has no budget'])
})
