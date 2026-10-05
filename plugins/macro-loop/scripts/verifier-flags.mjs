#!/usr/bin/env node
// The plugin's PreToolUse hook on the Agent tool (#36), from hooks/hooks.json. The spec's
// commands and the repo's tests both run a PR's code, so for a PR whose author is not trusted
// they get one answer: an answer that allows only some of them is a no for all of them. When
// a spec verifier is about to start with `Run spec commands` and `Run tests and lint` set
// differently, this finds the open PR at its `Head`; if that PR's author is not trusted
// (scripts/trust.mjs), both lines become `no`. Everything else passes through unchanged. A
// `Head` GitHub does not have (HTTP 422 "No commit found") cannot be any PR's head, so it counts
// as no open PR (#66). Every other failed lookup refuses the start instead of guessing.
//
// It belongs to the plugin, not to verify's frontmatter: a skill's hooks live only in the
// process that ran the skill, and verify starts its verifiers on the turn after its question,
// which can come in a resumed session.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TRUST = fileURLToPath(new URL('./trust.mjs', import.meta.url))

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${[cmd === process.execPath ? 'node' : cmd, ...args].join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return JSON.parse(r.stdout)
}

function pullsAt(head) {
  try {
    return run('gh', ['api', `repos/{owner}/{repo}/commits/${head}/pulls`], input.cwd)
  } catch (e) {
    if (/No commit found for SHA.*\(HTTP 422\)/.test(e.message)) return []
    throw e
  }
}

const answer = (fields) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } }))

const input = JSON.parse(readFileSync(0, 'utf8'))
const call = input.tool_input ?? {}
const prompt = String(call.prompt ?? '')
const line = (name) => new RegExp(`^${name}: (yes|no)$`, 'm').exec(prompt)?.[1]
const runSpec = line('Run spec commands')
const runTests = line('Run tests and lint')

if (call.subagent_type === 'macro-loop:verifier' && /^Axis: spec$/m.test(prompt) && runSpec && runTests && runSpec !== runTests) {
  try {
    const head = /^Head: ([0-9a-f]{7,40})$/m.exec(prompt)?.[1]
    if (!head) throw new Error('the spec verifier has no Head line')
    const prs = pullsAt(head).filter((pr) => pr.state === 'open' && pr.head.sha.startsWith(head))
    const untrusted = prs.map((pr) => run(process.execPath, [TRUST, '--pr', String(pr.number)], input.cwd).pr).find((pr) => !pr.authorTrusted)
    if (untrusted) {
      const no = prompt.replace(/^Run spec commands: (yes|no)$/m, 'Run spec commands: no').replace(/^Run tests and lint: (yes|no)$/m, 'Run tests and lint: no')
      answer({
        permissionDecision: 'allow',
        updatedInput: { ...call, prompt: no },
        additionalContext: `macro-loop: PR #${untrusted.number} is by ${untrusted.author}, who is not trusted, and the spec verifier was about to run the spec's commands and the tests differently. Both run that author's code, so an answer that allows only some of them is a no for all of them: both lines were set to no, and the verifier judges every criterion from the diff. Tell the user.`,
      })
    }
  } catch (e) {
    answer({ permissionDecision: 'deny', permissionDecisionReason: `macro-loop could not check whether the PR's author is trusted, so the spec verifier was not started: ${e.message}` })
  }
}
