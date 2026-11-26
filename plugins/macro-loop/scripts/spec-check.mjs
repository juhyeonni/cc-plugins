#!/usr/bin/env node
// Checks a spec draft before `spec` publishes it (#259): every decision is named by a criterion
// (`AC2 (D1). ...`, as a whole ID) or ends its line with `No check: <reason>`. It also counts the
// criteria and those whose check is `test` or `cmd` (#283): `fewRunnable` is a warning, never a gap.
//
//   node spec-check.mjs <draft file>
//
// Prints `{"uncovered": ["D2", ...], "criteria": 3, "runnable": 1, "fewRunnable": true}`. A draft
// it cannot read prints nothing on stdout, names why on stderr and exits non-zero: an unreadable
// draft is never clean (ADR-0016).
import { readFileSync } from 'node:fs'

function draftCoverage(draft) {
  const lines = draft.split('\n')
  const criteria = lines.filter((l) => /^\s*- \[[ xX]\] AC\d+/.test(l))
  const uncovered = lines
    .map((l) => l.match(/^\s*- (D\d+)\./))
    .filter((m) => m && !/No check:\s*\S.*$/.test(m.input))
    .map((m) => m[1])
    .filter((id) => !criteria.some((c) => new RegExp(`\\b${id}\\b`).test(c)))
  const runnable = criteria.filter((c) => /\bcheck:\s*(test|cmd)\b/.test(c)).length
  return { uncovered, criteria: criteria.length, runnable, fewRunnable: runnable * 2 < criteria.length }
}

let draft
try {
  draft = readFileSync(process.argv[2], 'utf8')
} catch (e) {
  console.error(`spec-check: cannot read the draft: ${e.message}`)
  process.exit(1)
}
console.log(JSON.stringify(draftCoverage(draft)))
