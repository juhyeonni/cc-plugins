#!/usr/bin/env node
// Writes verify's verdict comment from the verifiers' reports (#164), so the session that wrote
// the change does not write what a person reads first. Each report ends with a fenced
// `macro-loop-report` block (agents/verifier.md); the verdict and the opening paragraph come
// from those blocks alone, never from the prose, which is posted under them as it is.
//
//   node verdict.mjs --round <n> --head <sha> --branch <name> [--pr <n>] (--agent <id> | <report file>)...
//   node verdict.mjs --security --head <sha> (--agent <id> | <report file>)
//
// Give one spec and one standards report per Issue the PR closes: as `--agent <id>`, the report
// verifier-report.mjs saved when that agent stopped (#176), or as a file. The verdict takes no
// security report: the security review runs after a PASS and posts a comment of its own (#343),
// which `--security` writes from the security reviewer's one report to `security-<head>.md`.
// A PASS heading counts the criteria run over every Issue, and a PASS with no criterion run
// opens with what to read before merging (#283).
// Scope creep in a spec report goes under "Decide first" and never changes the result (#254). It writes
// the comment to `verdict-<head>.md` in the reports directory, whether the reports came as files
// or by `--agent` (#315), and prints that path and the heading. A missing
// or invalid block, a missing report, or a non-empty could-not-run list prints nothing on
// stdout, names why on stderr and exits non-zero: nothing is posted. So does a spec report that
// does not judge every criterion of the Issue's trusted spec, which the script finds itself (#252),
// or a trusted spec from which no criterion can be read (#271), and reports that leave out an Issue
// the PR closes, which it also finds itself (#270): the PR `--pr` names, or else the branch's open PR (#279).
// A trusted spec comment updated after the PR's previous verdict on the same head goes under
// "Decide first" and never changes the result (#279).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMain } from './is-main.mjs'
import { parseArgs } from 'node:util'
import { api, closesAll, comments, specOf, trustContext, verdictMarker, verdictsOf } from './trust.mjs'
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
  if (d.axis === 'security') {
    for (const k of ['findings', 'couldNotRun']) if (!strings(d[k])) bad(`needs \`${k}\`, a list of strings`)
    return
  }
  if (!Number.isInteger(d.issue) || d.issue < 1) bad('has no `issue` number')
  if (d.axis === 'standards') {
    if (!Array.isArray(d.standardsBroken)) bad('needs `standardsBroken`, a list')
    for (const b of d.standardsBroken) {
      if (!isObject(b) || !text(b.standard)) bad(`has a broken standard that is not {standard, answered?}: ${JSON.stringify(b)}`)
      answered(b, 'a broken standard', bad)
    }
    return
  }
  if (d.axis !== 'spec') bad('needs `axis`, spec, standards or security')
  if (d.spec !== null && !Number.isInteger(d.spec)) bad('needs `spec`, the spec comment id or null')
  if (!Array.isArray(d.criteria)) bad('needs `criteria`, a list')
  const wrong = d.criteria.find((c) => !isCriterion(c))
  if (wrong) bad(`has a criterion that is not {id, words, result, judged}: ${JSON.stringify(wrong)}`)
  for (const c of d.criteria.filter(isFailed)) classed(c, `${c.result} criterion ${c.id}`, bad)
  for (const k of ['manualChecks', 'couldNotRun', 'scopeCreep']) if (!strings(d[k])) bad(`needs \`${k}\`, a list of strings`)
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

// A spec edited after the previous verdict on this head comes first (#279), then behavior the spec
// did not ask for (#254), then broken standards. Neither of the first two changes the result.
function opening(issues, result, round, branch, specEdits) {
  const tag = (i) => (issues.length > 1 ? `#${i.number} ` : '')
  const numbered = (prefix, list) => list.map(([i, f], k) => ({ f, id: `- ${tag(i)}${prefix}${k + 1} ` }))
  const standards = numbered('S', issues.flatMap((i) => i.standards.data.standardsBroken.map((b) => [i, b])))
  const broken = standards.filter((s) => !s.f.answered).map((s) => s.id + s.f.standard)
  const settled = standards.filter((s) => s.f.answered).map((s) => `${s.id}${s.f.standard}, ${answeredNote(s.f)}`)
  const groups = [
    ['a spec was edited after the previous verdict', specEdits.map((e) => `- ${e}`)],
    ['the Spec report found behavior the spec did not ask for', issues.flatMap((i) => i.spec.data.scopeCreep.map((s) => `- ${tag(i)}${s}`))],
    ['the Standards report says the diff breaks these documented standards', broken],
  ].filter(([, list]) => list.length)
  const firstLine = groups.length ? `Decide first: ${groups[0][0]}:` : 'Nothing to decide first.'
  const rest = [
    ...groups.flatMap(([head, list], k) => [...(k ? ['', head[0].toUpperCase() + head.slice(1) + ':'] : []), '', ...list]),
    ...(settled.length ? ['', 'Standards findings already answered:', '', ...settled] : []),
  ]
  if (result === 'PASS') return [`${passOpening(issues)} ${firstLine}`, ...rest].join('\n')
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

// A PASS with no criterion run says what to read before merging instead of "This PR can merge"
// (#283). It reads the reports' data only, never their prose.
function passOpening(issues) {
  const manual = issues.some((i) => i.spec.data.manualChecks.length)
  const noneRan = !issues.some((i) => i.spec.data.criteria.some((c) => c.judged === 'ran'))
  if (!noneRan) return `This PR can merge. ${manual ? 'Do the manual checks below, read' : 'Read'} this verdict, mark the draft "Ready for review", then merge.`
  const read = 'Read the criteria before you merge: no criterion was run, each was only read or left to a manual check.'
  return `${read} ${manual ? 'Do the manual checks below, then mark' : 'Then mark'} the draft "Ready for review" and merge only if you accept that.`
}

const judgedAgainst = (i) =>
  `**Judged against:** ${i.spec.data.spec === null ? 'no spec; judged against the Issue body' : `the spec comment on #${i.number}`}`

// The security review is not part of the verdict: it runs after a PASS (#343).
const securityNote = (wait) => [
  '### Security',
  '',
  `The security review runs after a PASS, in the background, and posts its findings as a comment of its own on this PR. They never change this verdict.${wait ? ' `security.waitBeforeMerge` is on: wait for that comment before you merge.' : ''}`,
  '',
]

// The security reviewer's comment for one head (#343): its findings, or none, and what to do with them.
export function securityComment({ head, report }) {
  if (report.data.axis !== 'security') throw new Error(`--security takes the security reviewer's report, not a ${report.data.axis} report`)
  const { findings, couldNotRun } = report.data
  const result = couldNotRun.length ? 'did not run' : findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}` : 'no findings'
  const summary = couldNotRun.length
    ? `Security did not run: ${couldNotRun.join('; ')}. Once that is fixed, ask for it again with \`/macro-loop:verify security\`.`
    : findings.length
      ? 'Fix each finding you accept: on this PR before it merges, or in a new PR after. They never change the verdict.'
      : 'No findings. Nothing to do.'
  const list = findings.map((f) => `- ${f}`)
  return [
    `<!-- macro-loop:security sha=${head} -->`,
    `## Security review: ${result}`,
    '',
    summary,
    ...(list.length ? ['', ...list] : []),
    ...(report.prose ? ['', report.prose] : []),
  ].join('\n') + '\n'
}

const sections = (i) => [judgedAgainst(i), '', '### Spec', '', i.spec.prose, '', '### Standards', '', i.standards.prose]

export function verdict({ round, head, branch, reports, specEdits = [], waitForSecurity = false }) {
  if (reports.some((r) => r.data.axis === 'security')) throw new Error('the verdict takes no security report: the security review runs after a PASS')
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
    `## Verify: ${result} (${result === 'PASS' ? `${count('ran')} of ${criteria.length} criteria ran, ` : ''}round ${round} of 3)`,
    `**Criteria:** ${count('ran')} ran, ${count('read')} read, ${count('manual')} manual`,
    '',
    opening(issues, result, round, branch, specEdits),
    '',
    ...(manual.length ? manual : ['No manual checks']),
    '',
    ...securityNote(waitForSecurity),
    ...body,
  ].join('\n').trimEnd() + '\n'
}

// The AC IDs of a spec's acceptance-criteria lines, with or without `check:`, as spec-check.mjs counts them.
export const specCriteria = (body) => [...String(body ?? '').matchAll(/^\s*- \[[ xX]\] (AC\d+)\b/gm)].map((m) => m[1])

// Each Issue's trusted spec comment, or null, found as trust.mjs finds it: never from the reports.
function trustedSpecs(numbers, trusted) {
  return new Map(
    numbers.map((n) => {
      const list = comments(n)
      const id = specOf(list, trusted)
      return [n, id === null ? null : list.find((c) => c.id === id)]
    }),
  )
}

// A spec report that names another spec, or leaves out a criterion of the trusted one, is INCONCLUSIVE,
// and so is a trusted spec from which no criterion can be read (#271).
export function checkCoverage(report, spec) {
  const n = report.issue
  if (!spec) {
    if (report.spec !== null) throw new Error(`INCONCLUSIVE: the spec report for #${n} names spec ${report.spec}, but #${n} has no trusted spec`)
    if (!report.criteria.length) throw new Error(`INCONCLUSIVE: #${n} has no trusted spec, and the spec report judges no criterion against the Issue body`)
    return
  }
  if (report.spec !== spec.id) throw new Error(`INCONCLUSIVE: the spec report for #${n} names spec ${report.spec}, not #${n}'s trusted spec comment ${spec.id}`)
  const expected = specCriteria(spec.body)
  if (!expected.length) throw new Error(`INCONCLUSIVE: no acceptance-criterion line could be read from #${n}'s spec comment ${spec.id}`)
  const judged = new Set(report.criteria.map((c) => c.id))
  const missing = expected.filter((id) => !judged.has(id))
  if (missing.length) throw new Error(`INCONCLUSIVE: the spec report for #${n} does not judge ${missing.join(', ')} of spec comment ${spec.id}`)
}

// The PR `--pr` names, or else the branch's open PR, or null: the branch lookup finds nothing
// for a fork branch or one named pr-<n> (#279).
const prOf = (number, branch) =>
  number
    ? api([`repos/{owner}/{repo}/pulls/${number}`])
    : (api([`repos/{owner}/{repo}/pulls?head={owner}:${encodeURIComponent(branch)}&state=open`])[0] ?? null)

// One line per trusted spec updated after the PR's previous trusted verdict, found as trust.mjs
// finds pr.lastVerdict (ADR-0009), when that verdict judged this head or recorded no head (#279, ADR-0016).
function specEditsOf(prComments, specs, head, trusted) {
  const verdicts = verdictsOf(prComments, trusted)
  const previous = verdicts.at(-1)
  if (!previous) return []
  const round = verdicts.length
  const sha = verdictMarker(previous.body)?.[2]
  if (sha && !head.startsWith(sha) && !sha.startsWith(head)) return []
  const edited = [...specs].filter(([, s]) => s && s.updated_at > previous.created_at)
  return edited.map(([n]) =>
    sha
      ? `#${n}: the spec changed since round ${round} on this head; a person confirms the edit.`
      : `#${n}: the spec was updated after round ${round}, whose verdict recorded no head, so it cannot tell whether the spec changed on this head; a person confirms the edit.`,
  )
}

// Each Issue the PR closes needs a spec and a standards report, or the verdict is INCONCLUSIVE.
function checkClosed(closed, reports) {
  for (const n of closed) {
    for (const axis of ['spec', 'standards']) {
      if (!reports.some((r) => r.data.axis === axis && r.data.issue === n)) throw new Error(`INCONCLUSIVE: the PR closes #${n}, but there is no ${axis} report for #${n}`)
    }
  }
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
    options: { round: { type: 'string' }, head: { type: 'string' }, branch: { type: 'string' }, pr: { type: 'string' }, agent: { type: 'string', multiple: true }, security: { type: 'boolean' } },
    allowPositionals: true,
  })
  if (!/^[0-9a-f]{7,40}$/.test(values.head ?? '')) throw new Error('--head takes the commit sha the verifiers judged')
  const agents = values.agent ?? []
  if (!positionals.length && !agents.length) throw new Error('no reports given')
  const reports = [
    ...positionals.map((file) => parseReport(readFileSync(file, 'utf8'), file)),
    ...agents.map((id) => parseReport(savedReport(id), `the report of verifier ${id}`)),
  ]
  if (values.security) {
    if (reports.length !== 1) throw new Error(`--security takes one report, not ${reports.length}`)
    return write(`security-${values.head}.md`, securityComment({ head: values.head, report: reports[0] }), 1)
  }
  if (!/^[1-9]\d*$/.test(values.round ?? '')) throw new Error('--round takes the round number')
  if (!values.branch) throw new Error('--branch takes the branch name')
  if (values.pr !== undefined && !/^[1-9]\d*$/.test(values.pr)) throw new Error('--pr takes the PR number')
  const pr = prOf(values.pr, values.branch)
  checkClosed(pr ? closesAll(pr.body) : [], reports)
  const specReports = reports.filter((r) => r.data.axis === 'spec').map((r) => r.data)
  const { trusted, config } = trustContext()
  const specs = trustedSpecs([...new Set(specReports.map((d) => d.issue))], trusted)
  const specEdits = pr ? specEditsOf(comments(pr.number), specs, values.head, trusted) : []
  const waitForSecurity = config.security?.waitBeforeMerge === true
  const comment = verdict({ round: Number(values.round), head: values.head, branch: values.branch, reports, specEdits, waitForSecurity })
  for (const d of specReports) checkCoverage(d, specs.get(d.issue))
  return write(`verdict-${values.head}.md`, comment, 2)
}

// The comment goes to a file beside the saved reports, so the session needs no directory or
// redirect of its own, and only the file and its heading reach its context.
function write(name, comment, headingLines) {
  mkdirSync(reportsDir(), { recursive: true, mode: 0o700 })
  const out = join(reportsDir(), name)
  writeFileSync(out, comment)
  return `${out}\n${comment.split('\n').slice(1, 1 + headingLines).join('\n')}\n`
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(main(process.argv.slice(2)))
  } catch (e) {
    process.stderr.write(`verdict.mjs: nothing to post: ${e.message}\n`)
    process.exitCode = 1
  }
}
