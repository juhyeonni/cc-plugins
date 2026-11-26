#!/usr/bin/env node
// Checks a spec draft before `spec` publishes it (#259): every decision is named by a criterion
// (`AC2 (D1). ...`, as a whole ID) or ends its line with `No check: <reason>`.
//
//   node spec-check.mjs <draft file>
//
// Prints `{"uncovered": ["D2", ...]}`. A draft it cannot read prints nothing on stdout, names
// why on stderr and exits non-zero: an unreadable draft is never clean (ADR-0016).
import { readFileSync } from 'node:fs'

function uncovered(draft) {
  const lines = draft.split('\n')
  const criteria = lines.filter((l) => /^\s*- \[[ xX]\] AC\d+/.test(l))
  return lines
    .map((l) => l.match(/^\s*- (D\d+)\./))
    .filter((m) => m && !/No check:\s*\S.*$/.test(m.input))
    .map((m) => m[1])
    .filter((id) => !criteria.some((c) => new RegExp(`\\b${id}\\b`).test(c)))
}

let draft
try {
  draft = readFileSync(process.argv[2], 'utf8')
} catch (e) {
  console.error(`spec-check: cannot read the draft: ${e.message}`)
  process.exit(1)
}
console.log(JSON.stringify({ uncovered: uncovered(draft) }))
