#!/usr/bin/env node
// Writes verify's verdict comment from the verifiers' reports (#164), so the session that wrote
// the change does not write what a person reads first. Each report ends with a fenced
// `macro-loop-report` block (agents/verifier.md); the verdict and the opening paragraph come
// from those blocks alone, never from the prose, which is posted under them as it is.
//
//   node verdict.mjs --round <n> --head <sha> --branch <name> (--agent <id> | <report file>)...
//
// Give one spec and one standards report per Issue the PR closes: as `--agent <id>`, the
// report verifier-report.mjs saved when that verifier stopped (#176), or as a file. From files
// it prints the comment to post; from `--agent` it writes the comment to
// `verdict-<head>.md` in the reports directory and prints that path and the heading. A missing
// or invalid block, a missing report, or a non-empty could-not-run list prints nothing on
// stdout, names why on stderr and exits non-zero: nothing is posted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { reportPath, reportsDir } from './verifier-report.mjs'

const TAG = '```macro-loop-report'
const RESULTS = ['met', 'unmet', 'wrong', 'manual']
const JUDGED = ['ran', 'read', 'manual']

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const text = (s) => typeof s === 'string' && s.trim() !== ''
const strings = (x) => Array.isArray(x) && x.every(text)
const isCriterion = (c) => isObject(c) && typeof c.id === 'string' && c.id !== '' && typeof c.words === 'string' && RESULTS.includes(c.result) && JUDGED.includes(c.judged)
const isFailed = (c) => c.result === 'unmet' || c.result === 'wrong'

// A finding the verifier matched to an answer carries `answered`, the answer comment's id (#198).
function answered(f, what, bad) {
  if (f.answered !== undefined && !(Number.isInteger(f.answered) && f.answered > 0)) bad(`has ${what} whose \`answered\` is not a comment id: ${JSON.stringify(f)}`)
}

// An unmet or wrong criterion and an introduced failure name their class of bug and the other
// places in the diff where it occurs (#198).
function classed(f, what, bad) {
  if (!text(f.class)) bad(`has ${what} without \`class\`: ${JSON.stringify(f)}`)
  if (!strings(f.alsoAt)) bad(`has ${what} without \`alsoAt\`, a list of file:line: ${JSON.stringify(f)}`)
  answered(f, what, bad)
}

function validate(d, bad) {
  if (!isObject(d)) bad('is not a JSON object')
  if (!Number.isInteger(d.issue) || d.issue < 1) bad('has no `issue` number')
  if (d.axis === 'standards') {
    if (!Array.isArray(d.standardsBroken)) bad('needs `standardsBroken`, a list')
    for (const b of d.standardsBroken) {
      if (!isObject(b) || !text(b.standard)) bad(`has a broken standard that is not {standard, answered?}: ${JSON.stringify(b)}`)
      answered(b, 'a broken standard', bad)
    }
    return
  }
  if (d.axis !== 'spec') bad('needs `axis`, spec or standards')
  if (d.spec !== null && !Number.isInteger(d.spec)) bad('needs `spec`, the spec comment id or null')
  if (!Array.isArray(d.criteria)) bad('needs `criteria`, a list')
  const wrong = d.criteria.find((c) => !isCriterion(c))
  if (wrong) bad(`has a criterion that is not {id, words, result, judged}: ${JSON.stringify(wrong)}`)
  for (const c of d.criteria.filter(isFailed)) classed(c, `${c.result} criterion ${c.id}`, bad)
  for (const k of ['manualChecks', 'couldNotRun']) if (!strings(d[k])) bad(`needs \`${k}\`, a list of strings`)
  if (!Array.isArray(d.introducedFailures)) bad('needs `introducedFailures`, a list')
  for (const f of d.introducedFailures) {
    if (!isObject(f) || !text(f.failure)) bad(`has an introduced failure that is not {failure, class, alsoAt}: ${JSON.stringify(f)}`)
    classed(f, 'an introduced failure', bad)
  }
}

// A report's prose, and the data in the block it ends with.
export function parseReport(text, name) {
  const at = text.lastIndexOf(TAG)
  const m = at < 0 ? null : /^```macro-loop-report\n([\s\S]*)\n```\s*$/.exec(text.slice(at))
  if (!m) throw new Error(`${name} does not end with a \`macro-loop-report\` block`)
  const bad = (what) => {
    throw new Error(`${name}: its macro-loop-report block ${what}`)
  }
  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    bad(`is not valid JSON: ${e.message}`)
  }
  validate(data, bad)
  return { prose: text.slice(0, at).trim(), data }
}

const failed = (spec) => spec.criteria.filter(isFailed)
const resultOf = (spec) => (failed(spec).length || spec.introducedFailures.length ? 'NEEDS-FIX' : 'PASS')

function byIssue(reports) {
  const issues = new Map()
  for (const r of reports) {
    const i = issues.get(r.data.issue) ?? {}
    if (i[r.data.axis]) throw new Error(`two ${r.data.axis} reports for #${r.data.issue}`)
    issues.set(r.data.issue, { ...i, number: r.data.issue, [r.data.axis]: r })
  }
  for (const i of issues.values()) {
    for (const axis of ['spec', 'standards']) if (!i[axis]) throw new Error(`no ${axis} report for #${i.number}`)
    const cannot = i.spec.data.couldNotRun
    if (cannot.length) throw new Error(`INCONCLUSIVE: the spec verifier for #${i.number} could not run: ${cannot.join('; ')}`)
  }
  return [...issues.values()]
}

// Every finding has an ID unique within the verdict, so an answer can name it (#196): a
// criterion keeps its AC ID, introduced failures are F1, F2…, broken standards S1, S2…. A
// finding the verifier matched to an answer is one line linking the answer, and still counts (#198).
const answeredNote = (f) => `already answered ([the answer](#issuecomment-${f.answered}))`
const where = (f) => (f.alsoAt.length ? `also at ${f.alsoAt.join(', ')}` : 'no other place in the diff')
const finding = (f, line) => (f.answered ? `${line}, ${answeredNote(f)}` : `${line}. Class: ${f.class}; ${where(f)}`)

function opening(issues, result, round, branch) {
  const tag = (i) => (issues.length > 1 ? `#${i.number} ` : '')
  const numbered = (prefix, list) => list.map(([i, f], k) => ({ f, id: `- ${tag(i)}${prefix}${k + 1} ` }))
  const standards = numbered('S', issues.flatMap((i) => i.standards.data.standardsBroken.map((b) => [i, b])))
  const broken = standards.filter((s) => !s.f.answered).map((s) => s.id + s.f.standard)
  const settled = standards.filter((s) => s.f.answered).map((s) => `${s.id}${s.f.standard}, ${answeredNote(s.f)}`)
  const firstLine = broken.length ? 'Decide first: the Standards report says the diff breaks these documented standards:' : 'Nothing to decide first.'
  const rest = [...(broken.length ? ['', ...broken] : []), ...(settled.length ? ['', 'Standards findings already answered:', '', ...settled] : [])]
  if (result === 'PASS') {
    const manual = issues.some((i) => i.spec.data.manualChecks.length)
    return [`This PR can merge. ${manual ? 'Do the manual checks below, read' : 'Read'} this verdict, mark the draft "Ready for review", then merge. ${firstLine}`, ...rest].join('\n')
  }
  const items = [
    ...issues.flatMap((i) => failed(i.spec.data).map((c) => `- ${tag(i)}${finding(c, `${c.id} ${c.words}: ${c.result}`)}`)),
    ...numbered('F', issues.flatMap((i) => i.spec.data.introducedFailures.map((f) => [i, f]))).map((s) => s.id + finding(s.f, `Introduced failure: ${s.f.failure}`)),
  ]
  const next =
    round < 3
      ? `Next: run \`/macro-loop:implement ${branch}\` to fix the Spec findings; it hands back to verify.`
      : `This was round ${round} of 3: two re-verifications have not converged, so a person decides what happens next.`
  return ['This PR needs a fix:', '', ...items, '', `${next} ${firstLine}`, ...rest].join('\n')
}

const judgedAgainst = (i) =>
  `**Judged against:** ${i.spec.data.spec === null ? 'no spec; judged against the Issue body' : `the spec comment on #${i.number}`}`

const sections = (i) => [judgedAgainst(i), '', '### Spec', '', i.spec.prose, '', '### Standards', '', i.standards.prose]

export function verdict({ round, head, branch, reports }) {
  const issues = byIssue(reports)
  const result = issues.some((i) => resultOf(i.spec.data) === 'NEEDS-FIX') ? 'NEEDS-FIX' : 'PASS'
  const criteria = issues.flatMap((i) => i.spec.data.criteria)
  const count = (how) => criteria.filter((c) => c.judged === how).length
  const manual = issues.flatMap((i) => i.spec.data.manualChecks.map((m) => `- ${m}`))
  const body =
    issues.length === 1
      ? sections(issues[0])
      : issues.flatMap((i) => [`## #${i.number}: ${resultOf(i.spec.data)}`, '', ...sections(i), ''])
  return [
    `<!-- macro-loop:verify round=${round} sha=${head} -->`,
    `## Verify: ${result} (round ${round} of 3)`,
    `**Criteria:** ${count('ran')} ran, ${count('read')} read, ${count('manual')} manual`,
    '',
    opening(issues, result, round, branch),
    '',
    ...(manual.length ? manual : ['No manual checks']),
    '',
    ...body,
  ].join('\n').trimEnd() + '\n'
}

// The report verifier-report.mjs saved when that verifier stopped.
function savedReport(id) {
  const path = reportPath(id)
  if (!existsSync(path)) throw new Error(`no saved report for verifier ${id} (${path})`)
  return readFileSync(path, 'utf8')
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { round: { type: 'string' }, head: { type: 'string' }, branch: { type: 'string' }, agent: { type: 'string', multiple: true } },
    allowPositionals: true,
  })
  if (!/^[1-9]\d*$/.test(values.round ?? '')) throw new Error('--round takes the round number')
  if (!/^[0-9a-f]{7,40}$/.test(values.head ?? '')) throw new Error('--head takes the commit sha the verifiers judged')
  if (!values.branch) throw new Error('--branch takes the branch name')
  const agents = values.agent ?? []
  if (!positionals.length && !agents.length) throw new Error('no reports given')
  const reports = [
    ...positionals.map((file) => parseReport(readFileSync(file, 'utf8'), file)),
    ...agents.map((id) => parseReport(savedReport(id), `the report of verifier ${id}`)),
  ]
  const comment = verdict({ round: Number(values.round), head: values.head, branch: values.branch, reports })
  if (!agents.length) return comment
  // From saved reports, the comment goes to a file beside them, so the session needs no
  // directory or redirect of its own, and only the file and the heading reach its context.
  const out = join(reportsDir(), `verdict-${values.head}.md`)
  writeFileSync(out, comment)
  return `${out}\n${comment.split('\n').slice(1, 3).join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(main(process.argv.slice(2)))
  } catch (e) {
    process.stderr.write(`verdict.mjs: nothing to post: ${e.message}\n`)
    process.exitCode = 1
  }
}
