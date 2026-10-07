// The band's logic (#108): events in, state out, rows out, columns laid out. Pure and
// import-free, so it runs both under node --test and in the mod environment, which has no
// Node. Every export tolerates garbage, never throws and never mutates its arguments.
//
// State = { cur, waiting }: cur is the Run the band shows first, waiting the other Issues this
// session touched and has not finished (oldest first, one per Issue, never cur's) (D3).
//
// A Run also keeps the GitHub ids it observed (D15): its PR, the Issue's spec comment, and the
// PR's last verdict with its result. Given the repo, rows() turns them into links.

export const SKILLS = ['next', 'triage', 'grilling', 'spec', 'implement', 'open-pr', 'verify']
export const STAGES = ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'resumable', 'wait', 'merge', 'stop', 'done']
// D16: the track's six cells, and the cell each stage or skill sits on.
export const TRACK = ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'merge']
const POS = { triage: 0, wait: 0, resumable: 0, grilling: 1, spec: 1, implement: 2, 'open-pr': 3, verify: 4, merge: 5 }
// D15: one column per GitHub document a row can link; the Issue itself is the row's number.
export const LINK_COLUMNS = ['spec', 'pr', 'verdict']
// D17: the columns in order, and the order whole columns drop in when the band is narrow.
export const COLUMNS = ['symbol', 'number', 'track', 'stage', 'action', 'round', 'time', ...LINK_COLUMNS]
const DROP = ['round', 'time', 'action', 'verdict', 'spec', 'pr', 'track']
// D3: rows shown before the rest fold into one '+N more' row.
export const MAX_ROWS = 4
// Wide enough for every elapsed time up to 23h59m, so the links after it stay put (D17).
const TIME_WIDTH = 6
// Cells between columns; the glue draws with the same value.
export const GAP = 2

const SKILL = /^macro-loop:([a-z-]+)$/
const SYMBOL = { run: '▶', you: '◆', other: '◇', unknown: '?', done: '✓' }
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g
// Stages that leave a run on the person's turn: a skill started after one starts a new run.
const STOPPED = ['merge', 'stop', 'resumable']
const RESULTS = ['PASS', 'NEEDS-FIX']
// Owner and repo as GitHub names them, after an https, scp-like or ssh:// GitHub host.
const REMOTE = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i

export const initial = () => ({ cur: null, waiting: [] })

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const posInt = (v) => Number.isInteger(v) && v > 0
const optNum = (v) => v === undefined || v === null || posInt(v)
const width = (s) => [...s].length

const newRun = (at) => ({
  issue: null, skill: null, stage: null, why: null, failed: false,
  pr: null, round: null, running: false, since: at, idleSince: null, done: false,
  spec: null, verdict: null, verdictResult: null, pos: null,
})

// What a Run adopts from its Issue's waiting entry.
const KEPT = ['pr', 'round', 'stage', 'spec', 'verdict', 'verdictResult', 'pos']

const same = (a, b) => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b)
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}

// A working copy: reduce edits it freely, the caller's state stays untouched.
const copy = (s) => {
  const o = isObj(s) ? s : {}
  return {
    cur: isObj(o.cur) ? { ...o.cur } : null,
    waiting: Array.isArray(o.waiting) ? o.waiting.filter(isObj).map((w) => ({ ...w })) : [],
  }
}

const shortReason = (why) => {
  const w = typeof why === 'string' ? why : ''
  const n = /^(\d+) verdicts/.exec(w)
  if (n) return `NEEDS-FIX ${n[1]}×`
  if (/^more than one state label/.test(w)) return 'state labels conflict'
  if (/^no rule fits/.test(w)) return 'no rule fits'
  return 'see /macro-loop:status'
}

// An Issue keeps its row until it is done (D3, D10); a failed check is the current row's alone.
const keep = (run) => posInt(run.issue) && !run.done && !run.failed

const takeWaiting = (s, issue) => {
  const i = s.waiting.findIndex((w) => w.issue === issue)
  return i < 0 ? null : s.waiting.splice(i, 1)[0]
}

const park = (s, run) => {
  takeWaiting(s, run.issue)
  s.waiting.push({ ...run, running: false })
}

const focus = (s, m, at) => {
  const c = s.cur
  if (c.issue === m) return
  if (c.issue === null || c.issue === undefined) {
    const w = takeWaiting(s, m)
    s.cur = { ...c, issue: m }
    if (w) for (const k of KEPT) if (s.cur[k] == null && w[k] != null) s.cur[k] = w[k]
    return
  }
  const w = takeWaiting(s, m)
  if (keep(c)) park(s, c)
  const base = w ?? newRun(at)
  s.cur = { ...base, skill: c.skill, running: c.running, since: c.since, issue: m, done: false, failed: false, pos: POS[c.skill] ?? base.pos }
}

const step = (s, ev) => {
  const at = ev.at
  switch (ev.type) {
    case 'skill': {
      const name = typeof ev.skill === 'string' ? SKILL.exec(ev.skill)?.[1] : undefined
      if (!SKILLS.includes(name)) return
      const stopped = s.cur && !s.cur.running && STOPPED.includes(s.cur.stage)
      if (name === 'next' || stopped || s.cur?.done || s.cur?.failed) {
        if (s.cur && keep(s.cur)) park(s, s.cur)
        s.cur = newRun(at)
      }
      s.cur ??= newRun(at)
      Object.assign(s.cur, { skill: name, stage: null, why: null, failed: false, done: false, running: true, since: at })
      if (POS[name] !== undefined) s.cur.pos = POS[name]
      return
    }
    case 'stage': {
      if (!optNum(ev.issue)) return
      const m = ev.issue ?? s.cur?.issue ?? null
      s.cur ??= newRun(at)
      if (m !== null) focus(s, m, at)
      if (ev.ok === true && STAGES.includes(ev.stage)) {
        Object.assign(s.cur, { stage: ev.stage, why: String(ev.why ?? ''), failed: false })
        // D16: a stop keeps the last position seen; done fills the track.
        if (POS[ev.stage] !== undefined) s.cur.pos = POS[ev.stage]
        if (ev.stage === 'done') {
          Object.assign(s.cur, { done: true, pos: TRACK.length })
          if (m !== null) takeWaiting(s, m)
        }
      } else s.cur.failed = true
      return
    }
    case 'trust': {
      // --pr gives the PR, its round and last verdict; an Issue (--issue, or the one the PR
      // closes) its spec: undefined when the output named no Issue, null when it has none yet.
      if (!optNum(ev.pr) || !optNum(ev.issue) || !s.cur || (ev.pr == null && ev.issue == null)) return
      if (ev.issue != null) focus(s, ev.issue, at)
      if (ev.pr != null) {
        const verdict = posInt(ev.verdict) ? ev.verdict : null
        Object.assign(s.cur, {
          pr: ev.pr,
          round: Number.isInteger(ev.round) && ev.round >= 0 ? ev.round : null,
          verdict,
          verdictResult: verdict !== null && RESULTS.includes(ev.verdictResult) ? ev.verdictResult : null,
        })
      }
      if (ev.issue != null && ev.spec !== undefined) s.cur.spec = posInt(ev.spec) ? ev.spec : null
      return
    }
    case 'pr':
      if (!posInt(ev.pr) || !s.cur) return
      // A verdict belongs to the PR it judged.
      if (s.cur.pr !== ev.pr) Object.assign(s.cur, { verdict: null, verdictResult: null })
      s.cur.pr = ev.pr
      return
    case 'turnStart':
      if (s.cur?.done) s.cur = s.waiting.pop() ?? null
      // A skill's own row (no stage since it started) goes on: the person answered it.
      else if (s.cur?.skill && s.cur.stage === null && !s.cur.failed) s.cur.running = true
      return
    case 'turnEnd':
      if (s.cur?.running) Object.assign(s.cur, { running: false, idleSince: at })
      return
    case 'sessionEnd':
      if (ev.reason === 'clear' || ev.reason === 'resume') Object.assign(s, initial())
  }
}

export function reduce(state, ev) {
  try {
    if (!isObj(ev) || ev.agentId || typeof ev.type !== 'string' || !Number.isFinite(ev.at)) return state
    const s = copy(state)
    step(s, ev)
    return same(s, state) ? state : s
  } catch {
    return state
  }
}

// owner/repo from a remote URL (`git remote get-url origin`), or null for anything but GitHub.
export function repoOf(url) {
  try {
    if (typeof url !== 'string') return null
    const m = REMOTE.exec(url.trim())
    if (!m || [m[1], m[2]].some((n) => n === '.' || n === '..')) return null
    return { owner: m[1], repo: m[2] }
  } catch {
    return null
  }
}

const repoBase = (repo) => {
  if (!isObj(repo) || typeof repo.owner !== 'string' || typeof repo.repo !== 'string') return null
  const ok = repoOf(`https://github.com/${repo.owner}/${repo.repo}`)
  return ok && ok.owner === repo.owner && ok.repo === repo.repo ? `https://github.com/${ok.owner}/${ok.repo}` : null
}

// D15: a Run's documents, whatever its stage: each one whose id the session observed, null
// for one it did not. Labels are bracketed, so they read as documents beside the Issue number.
const linksOf = (run, base) => {
  const none = { spec: null, pr: null, verdict: null }
  if (!base) return none
  const issue = posInt(run.issue) ? run.issue : null
  const pr = posInt(run.pr) ? run.pr : null
  return {
    spec: issue && posInt(run.spec) ? { label: '[Spec]', href: `${base}/issues/${issue}#issuecomment-${run.spec}` } : null,
    pr: pr ? { label: `[PR#${pr}]`, href: `${base}/pull/${pr}` } : null,
    verdict: pr && posInt(run.verdict) ? { label: '[Verdict]', href: `${base}/pull/${pr}#issuecomment-${run.verdict}` } : null,
  }
}

// D16: the six cells, '' when no position was seen.
export function track(pos) {
  if (!Number.isInteger(pos) || pos < 0) return ''
  return TRACK.map((_, i) => (i < pos ? '●' : i === pos ? '◐' : '○')).join('')
}

const since = (run, now, idle) => elapsed(now - (idle ? (run.idleSince ?? run.since) : run.since))
const stageAt = (run, fallback) => TRACK[run.pos] ?? fallback

// D4: what a stopped Run's row says, from its stage, else its skill.
const personRow = (run) => {
  const key = run.stage ?? run.skill
  if (key === 'merge') return { tone: 'you', stage: 'merge', action: 'merge the PR' }
  if (key === 'stop') return { tone: 'you', stage: stageAt(run, 'stop'), action: `decide: ${shortReason(run.why)}` }
  if (key === 'resumable') return { tone: 'you', stage: 'triage', action: 'read reply' }
  if (key === 'wait') return { tone: 'other', stage: 'triage', action: '(requester)' }
  if (key === 'grilling') return { tone: 'you', stage: 'grilling', action: 'answer Qs' }
  return { tone: 'you', stage: key ?? 'next', action: 'answer above' }
}

// One Run's row: { tone, issue, href, track, stage, action, round, time, links }.
function rowOf(run, { isWorking, now, base }, isCur) {
  const issue = posInt(run.issue) ? run.issue : null
  let row
  if (run.failed) row = { tone: 'unknown', stage: stageAt(run, ''), action: 'run /macro-loop:status' }
  else if (run.done) row = { tone: 'done', stage: 'merge' }
  else if (isCur && run.running && isWorking) {
    // A working next is about its Issue's stage.
    row = { tone: 'run', stage: (run.skill === 'next' || !run.skill ? run.stage : run.skill) ?? 'next', time: since(run, now, false) }
  } else row = { ...personRow(run), time: since(run, now, true) }
  return {
    ...row,
    issue,
    href: base && issue ? `${base}/issues/${issue}` : null,
    track: track(run.pos),
    round: !run.done && Number.isInteger(run.round) ? `r${run.round}` : '',
    links: linksOf(run, base),
  }
}

// The rows to show, the current Issue first and the others oldest first, before layout; null
// when there is nothing to show.
export function rows(state, opts) {
  try {
    const o = isObj(opts) ? opts : {}
    const cur = isObj(state) && isObj(state.cur) ? state.cur : null
    const waiting = isObj(state) && Array.isArray(state.waiting) ? state.waiting.filter(isObj) : []
    const runs = cur ? [cur, ...waiting] : waiting
    if (!runs.length) return null
    const ctx = { isWorking: o.isWorking === true, now: Number.isFinite(o.now) ? o.now : 0, base: repoBase(o.repo) }
    return runs.map((r) => rowOf(r, ctx, r === cur))
  } catch {
    return null
  }
}

// A cell's text in a column.
const cellText = (r, col) => {
  if (col === 'symbol') return SYMBOL[r.tone] ?? ''
  if (col === 'number') return r.issue ? `#${r.issue}` : ''
  if (LINK_COLUMNS.includes(col)) return r.links[col]?.label ?? ''
  return clean(r[col] ?? '')
}

// A row's links as layout keeps them: each one with an address, its label cleaned.
const cleanLinks = (links) => Object.fromEntries(LINK_COLUMNS.map((c) => {
  const l = isObj(links) ? links[c] : null
  return [c, isObj(l) && typeof l.href === 'string' && l.href ? { label: clean(l.label), href: l.href } : null]
}))

// D17: fixed columns, each as wide as its widest cell (time fixed); whole columns drop in
// DROP's order until the rows fit `columns`. A column no row fills takes no room.
export function layout(rs, columns) {
  try {
    if (!Array.isArray(rs) || !rs.length) return null
    const list = rs.filter(isObj).map((r) => ({ ...r, links: cleanLinks(r.links) }))
    const shown = list.slice(0, list.length > MAX_ROWS ? MAX_ROWS : list.length)
    const more = list.length - shown.length
    const max = typeof columns === 'number' && !Number.isNaN(columns) ? columns : Infinity
    const dropped = new Set()
    const widths = () => Object.fromEntries(COLUMNS.map((c) => {
      if (dropped.has(c)) return [c, 0]
      const w = Math.max(0, ...shown.map((r) => width(cellText(r, c))))
      return [c, c === 'time' && w ? TIME_WIDTH : w]
    }))
    const total = (w) => {
      const used = COLUMNS.filter((c) => w[c] > 0)
      return used.reduce((n, c) => n + w[c], 0) + GAP * Math.max(0, used.length - 1)
    }
    for (const c of DROP) {
      if (total(widths()) <= max) break
      dropped.add(c)
    }
    const w = widths()
    const cols = COLUMNS.filter((c) => w[c] > 0)
    return {
      columns: cols.map((c) => ({ name: c, width: w[c] })),
      rows: shown.map((r) => ({
        tone: r.tone,
        cells: cols.map((c) => {
          const cell = { col: c, text: cellText(r, c), width: w[c] }
          if (c === 'number' && r.href) cell.href = r.href
          if (LINK_COLUMNS.includes(c) && r.links[c]) cell.href = r.links[c].href
          return cell
        }),
      })),
      more: more > 0 ? `+${more} more · /macro-loop:status` : null,
    }
  } catch {
    return null
  }
}

export function render(state, opts) {
  try {
    const o = isObj(opts) ? opts : {}
    return layout(rows(state, o), o.columns)
  } catch {
    return null
  }
}

// The laid-out band as lines of text: cells padded to their column, GAP spaces between.
export function lines(laid) {
  try {
    if (!isObj(laid) || !Array.isArray(laid.rows)) return []
    const pad = (c, last) => (last ? c.text : c.text + ' '.repeat(Math.max(0, c.width - width(c.text))))
    const out = laid.rows.map((r) => r.cells.map((c, i) => pad(c, i === r.cells.length - 1)).join(' '.repeat(GAP)).trimEnd())
    return laid.more ? [...out, laid.more] : out
  } catch {
    return []
  }
}

export function elapsed(ms) {
  const n = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0
  const m = Math.floor(n / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h${r}m` : `${h}h`
}

export function clean(s) {
  try {
    return String(s).replace(INVISIBLE, '')
  } catch {
    return ''
  }
}

export function signature(state, now, repo) {
  try {
    if (!rows(state, {})) return ''
    const at = (isWorking) => render(state, { isWorking, now, columns: Infinity, repo })
    return JSON.stringify([at(true), at(false)])
  } catch {
    return ''
  }
}
