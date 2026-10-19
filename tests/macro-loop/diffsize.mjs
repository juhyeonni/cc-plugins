// Counts the lines a run's branch adds and removes (#63), by kind: code, test, comment, other.
import { spawnSync } from 'node:child_process'

const CODE = /\.(c|m)?(js|ts)x?$/
const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\./
const IGNORED_BRANCH = /^worktree-agent-/

const empty = () => Object.fromEntries(['code', 'test', 'comment', 'other'].map((k) => [k, { add: 0, del: 0 }]))

function kindOf(path, text) {
  if (TEST.test(path)) return 'test'
  if (!CODE.test(path)) return 'other'
  return /^\s*(\/\/|\/\*|\*)/.test(text) ? 'comment' : 'code'
}

// `patch` is the output of `git diff -U0`. Blank lines are not counted.
export function countPatch(patch) {
  const counts = empty()
  let path = null
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false
      path = line.slice(line.lastIndexOf(' b/') + 3)
    } else if (line.startsWith('@@')) {
      inHunk = true
    } else if (inHunk && (line[0] === '+' || line[0] === '-') && line.slice(1).trim()) {
      counts[kindOf(path, line.slice(1))][line[0] === '+' ? 'add' : 'del']++
    }
  }
  return counts
}

function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

// Local branch name to tip.
export function branchTips(repo) {
  const out = git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads')
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => l.split(' ')))
}

// The one branch that appeared or moved, measured from the merge-base with origin/main
// (new branch) or its old tip (moved branch). Never throws: a failed measurement must not lose a run.
export function measureDiff(repo, before, after) {
  const changed = Object.keys(after).filter((b) => before[b] !== after[b] && !IGNORED_BRANCH.test(b))
  if (changed.length !== 1) return { diff: null, reason: `${changed.length} branches appeared or moved: ${changed.join(', ') || 'none'}` }
  const [branch] = changed
  try {
    const base = before[branch] ?? git(repo, 'merge-base', 'origin/main', after[branch])
    return { diff: { branch, ...countPatch(git(repo, 'diff', '-U0', base, after[branch])) } }
  } catch (e) {
    return { diff: null, reason: e.message }
  }
}
