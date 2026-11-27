import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REASON } from '../../plugins/macro-loop/scripts/plugin-reads.mjs'
import { goalGaps } from './checks.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HOOK = join(ROOT, 'plugins/macro-loop/scripts/plugin-reads.mjs')
const PLUGIN = '/home/u/.claude/plugins/macro-loop'

// Runs the hook as Claude Code would: a PreToolUse input on stdin, the plugin root in the env.
function hook(stdin) {
  const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN } })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null
}
const bash = (command) => hook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }))

test('#336 AC1: a Bash call reading or listing the plugin root is denied with the Read-tool reason', () => {
  for (const command of [
    `cat ${PLUGIN}/reference/core.md; ls ${PLUGIN}/scripts`,
    `head -20 "${PLUGIN}/skills/implement/SKILL.md"`,
    `git status && grep -n spec ${PLUGIN}/reference/github.md`,
    `ls ${PLUGIN}`,
    'cat ${CLAUDE_PLUGIN_ROOT}/reference/core.md',
  ]) {
    const out = bash(command)
    assert.equal(out?.permissionDecision, 'deny', command)
    assert.equal(out.permissionDecisionReason, REASON)
  }
  assert.equal(REASON, "Read the plugin's files with the Read tool, one per call; list them with Glob")
})

test('#336 AC2: the repo\'s own work and plugin scripts pass through with no decision', () => {
  for (const command of ['git ls-files', 'npm test', 'cat src/slugify.js', `node ${PLUGIN}/scripts/trust.mjs --issue 1`, `cat ${PLUGIN}-other/x`]) {
    assert.equal(bash(command), null, command)
  }
})

test('#336 AC4: input the hook cannot parse as a hook payload passes through', () => {
  for (const stdin of ['', 'not json', '[]', 'null', JSON.stringify({ tool_input: { command: 42 } }), JSON.stringify({ tool_name: 'Bash' })]) {
    assert.equal(hook(stdin), null, stdin)
  }
})

test('#336 AC3: goalGaps leaves out a denial naming the plugin root, and still lists any other', () => {
  const denials = [
    { tool_name: 'Bash', tool_input: { command: `cat ${PLUGIN}/reference/core.md` } },
    { tool_name: 'Bash', tool_input: { command: 'rm -r /tmp/x' } },
  ]
  const gaps = goalGaps({ denials, children: [], pluginRoot: PLUGIN })
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /permission denied: Bash .*rm -r \/tmp\/x/)
})
