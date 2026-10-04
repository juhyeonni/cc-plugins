// Measures the size of the change `implement` made in a run (#63): the lines the branch
// it committed to adds and removes, split into code, test, comment and other. It is a
// measurement, not a check: it never decides a pass.
import { spawnSync } from 'node:child_process'

const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^/]+$/
const CODE_FILE = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/
const COMMENT = /^\s*(\/\/|\/\*|\*)/
const BLANK = /^\s*$/

function kind(path, text) {
  if (TEST_FILE.test(path)) return 'test'
  if (!CODE_FILE.test(path)) return 'other'
  return COMMENT.test(text) ? 'comment' : 'code'
}

// Counts the added and removed lines of a unified diff, by kind. Blank lines are not counted.
export function countLines(diff) {
  const lines = Object.fromEntries(['code', 'test', 'comment', 'other'].map((k) => [k, { added: 0, removed: 0 }]))
  let path = null
  let inHunk = false
  for (const line of String(diff).split('\n')) {
    const file = /^diff --git a\/.* b\/(.*)$/.exec(line)
    if (file) {
      path = file[1]
      inHunk = false
    } else if (line.startsWith('@@')) {
      inHunk = true
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-')) && !BLANK.test(line.slice(1))) {
      lines[kind(path, line.slice(1))][line.startsWith('+') ? 'added' : 'removed']++
    }
  }
  return lines
}

// The branch the run committed to: the one that appeared or whose tip moved, from maps of
// branch name to tip. `base` is its tip before the run, or null for a new branch.
export function pickBranch(before, after) {
  const changed = Object.keys(after).filter((b) => !b.startsWith('worktree-agent-') && before[b] !== after[b])
  if (changed.length === 0) return { reason: 'no branch appeared or moved' }
  if (changed.length > 1) return { reason: `${changed.length} branches appeared or moved: ${changed.join(', ')}` }
  const [branch] = changed
  return { branch, base: before[branch] ?? null }
}

function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${repo}: ${r.stderr || r.stdout}`)
  return r.stdout
}

// Every local branch and the commit it points to.
export function branchTips(repo) {
  const out = git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').trim()
  return Object.fromEntries(out === '' ? [] : out.split('\n').map((l) => l.split(' ')))
}

// A new branch is measured from its merge-base with origin/main, a moved one from its old tip.
export function measureDiff(repo, before, after) {
  const picked = pickBranch(before, after)
  if (!picked.branch) return { diff: null, diffReason: picked.reason }
  const to = after[picked.branch]
  const from = picked.base ?? git(repo, 'merge-base', 'origin/main', to).trim()
  return { diff: { branch: picked.branch, from, to, lines: countLines(git(repo, 'diff', from, to)) } }
}
