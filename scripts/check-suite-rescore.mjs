// Fails a PR that changes the verifier unless it carries a rescore or says why it skipped one (#200).
//   PR_BODY=... node scripts/check-suite-rescore.mjs <base> <head>
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { BASELINE, isVerifierPath, parseBaseline } from '../tests/macro-loop/rescore.mjs'

const RESCORE = 'node tests/macro-loop/run.mjs --rescore'
const DASH = '(?:—|--?)'

// baseline: the head's parsed baseline file when the PR updates it or is a release, else null.
// changedSince: the verifier paths changed between its commit and the head; inHistory: whether that commit is in the branch.
// release: the PR changes the macro-loop manifest's version (#278).
export function check({ touched, body = '', baseline = null, changedSince = [], inHistory = false, release = false }) {
  if (release) {
    if (!baseline?.commit) return { ok: false, message: `release: ${BASELINE} names no commit, so what was measured cannot be told. Rescore: ${RESCORE}` }
    if (!inHistory) return { ok: false, message: `release: ${BASELINE} names ${baseline.commit}, which is not in this branch's history. Rescore: ${RESCORE}` }
    if (changedSince.length > 0) {
      return { ok: false, message: `release: the verifier changed after the rescore at ${baseline.commit}: ${changedSince.join(', ')}. \`Suite: skipped\` does not cover a release. Rescore: ${RESCORE}` }
    }
  }
  const paths = touched.filter(isVerifierPath)
  if (paths.length === 0) return { ok: true, message: 'no verifier path changed' }
  const text = String(body).replace(/\r/g, '')
  const skip = new RegExp(`^Suite: skipped ${DASH}(.*)$`, 'm').exec(text)
  if (skip && skip[1].trim()) return { ok: true, message: `rescore skipped: ${skip[1].trim()}` }
  if (skip) return { ok: false, message: '`Suite: skipped` has no reason' }
  if (!baseline) {
    return { ok: false, message: `these paths change the verifier: ${paths.join(', ')}. Run \`${RESCORE}\` and commit ${BASELINE}, or add a body line \`Suite: skipped — <reason>\`.` }
  }
  if (!inHistory) return { ok: false, message: `${BASELINE} names ${baseline.commit}, which is not in this branch's history. Rescore: ${RESCORE}` }
  if (changedSince.length > 0) {
    return { ok: false, message: `changed after the rescore at ${baseline.commit}: ${changedSince.join(', ')}. Rescore: ${RESCORE}` }
  }
  const unaccepted = [...baseline.rows.values()]
    .filter((r) => r.regression)
    .map((r) => r.id)
    .filter((id) => !new RegExp(`^Suite: accepted regression ${DASH} ${id}: \\S`, 'm').test(text))
  if (unaccepted.length > 0) {
    return { ok: false, message: `confirmed regression with no \`Suite: accepted regression — <scenario>: <reason>\` line: ${unaccepted.join(', ')}` }
  }
  return { ok: true, message: `rescored at ${baseline.commit}` }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const lines = (s) => s.split('\n').filter(Boolean)

const MANIFEST = 'plugins/macro-loop/.claude-plugin/plugin.json'

function versionAt(rev) {
  const r = spawnSync('git', ['show', `${rev}:${MANIFEST}`], { encoding: 'utf8' })
  if (r.status !== 0) return undefined
  try {
    return JSON.parse(r.stdout).version
  } catch {
    return undefined
  }
}

function collect(base, head) {
  const touched = lines(git('diff', '--name-only', `${base}...${head}`))
  const release = touched.includes(MANIFEST) && versionAt(git('merge-base', base, head)) !== versionAt(head)
  if (!touched.includes(BASELINE) && !release) return { touched }
  const shown = spawnSync('git', ['show', `${head}:${BASELINE}`], { encoding: 'utf8' })
  const baseline = parseBaseline(shown.status === 0 ? shown.stdout : '')
  const inHistory = baseline.commit != null && spawnSync('git', ['merge-base', '--is-ancestor', baseline.commit, head]).status === 0
  const changedSince = inHistory ? lines(git('diff', '--name-only', baseline.commit, head)).filter(isVerifierPath) : []
  return { touched, baseline, inHistory, changedSince, release }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2)
  const result = check({ ...collect(base, head), body: process.env.PR_BODY ?? '' })
  console.log(result.message)
  process.exit(result.ok ? 0 : 1)
}
