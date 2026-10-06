// The band's logic (#108): events in, state out, band text out. Pure and import-free, so it
// runs both under node --test and in the mod environment, which has no Node. Every export
// tolerates garbage, never throws and never mutates its arguments.
//
// State = { cur, waiting, asking }: cur is the Run the band shows, waiting the other Issues this
// session left on the person's turn (oldest first, one per Issue, never cur's), asking the
// tool_use_id of a main-loop call tool.check answered 'ask' for.
//
// A Run also keeps the GitHub ids it observed (D15): its PR, the Issue's spec comment, and the
// PR's last verdict with its result. Given the repo, band() turns them into links.

export const SKILLS = ['next', 'triage', 'grilling', 'spec', 'implement', 'open-pr', 'verify']
export const STAGES = ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'resumable', 'wait', 'merge', 'stop', 'done']

const SKILL = /^macro-loop:([a-z-]+)$/
const SYMBOL = { run: '▶', you: '◆', other: '◇', unknown: '?', done: '✓' }
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g
const SEP = ' · '
// Stages that leave a run on the person's turn: a skill started after one starts a new run.
const STOPPED = ['merge', 'stop', 'resumable']
const RESULTS = ['PASS', 'NEEDS-FIX']
// D15: the links a row shows, first link first, by the stage or skill it is about.
const LINKS = {
  triage: ['issue'], grilling: ['issue'], spec: ['spec'], implement: ['spec'],
  'open-pr': ['pr', 'spec'], verify: ['pr', 'spec'], merge: ['pr', 'verdict'],
}
// After a NEEDS-FIX verdict, the rows that fix it or stop on it.
const NEEDS_FIX = ['implement', 'stop']
// Owner and repo as GitHub names them, after an https, scp-like or ssh:// GitHub host.
const REMOTE = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i

export const initial = () => ({ cur: null, waiting: [], asking: null })

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const posInt = (v) => Number.isInteger(v) && v > 0
const optNum = (v) => v === undefined || v === null || posInt(v)

const newRun = (at) => ({
  issue: null, skill: null, stage: null, why: null, failed: false,
  pr: null, round: null, running: false, since: at, idleSince: null, done: false,
  spec: null, verdict: null, verdictResult: null,
})

// What a Run adopts from its Issue's waiting entry.
const KEPT = ['pr', 'round', 'stage', 'spec', 'verdict', 'verdictResult']

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
    asking: typeof o.asking === 'string' ? o.asking : null,
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

const since = (run, now, idle) => elapsed(now - (idle ? (run.idleSince ?? run.since) : run.since))

// Rule 5: the row a stopped Run shows, from its stage, else its skill.
const personRow = (run, now) => {
  const key = run.stage ?? run.skill
  const { pr, issue } = run
  if (key === 'merge') return { tone: 'you', head: 'PASS', action: pr ? `read verdict, merge PR #${pr}` : 'read verdict, merge the PR' }
  if (key === 'stop') return { tone: 'you', head: 'stopped', action: `${shortReason(run.why)} · decide` }
  if (key === 'resumable') return { tone: 'you', head: 'new reply', action: issue == null ? 'run /macro-loop:next' : `run /macro-loop:next ${issue}` }
  if (key === 'wait') return { tone: 'other', head: 'waiting on requester', time: since(run, now, true) }
  if (key === 'grilling') return { tone: 'you', head: 'grilling', action: 'answer the questions above' }
  return { tone: 'you', head: `${run.stage ?? run.skill ?? 'next'} asks`, action: 'see above', time: since(run, now, true) }
}

const personTurn = (run) => posInt(run.issue) && !run.done && !run.failed && personRow(run, 0).tone === 'you'

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
  if (personTurn(c)) park(s, c)
  s.cur = { ...(w ?? newRun(at)), skill: c.skill, running: c.running, since: c.since, issue: m, done: false, failed: false }
}

const step = (s, ev) => {
  const at = ev.at
  switch (ev.type) {
    case 'skill': {
      const name = typeof ev.skill === 'string' ? SKILL.exec(ev.skill)?.[1] : undefined
      if (!SKILLS.includes(name)) return
      const stopped = s.cur && !s.cur.running && STOPPED.includes(s.cur.stage)
      if (name === 'next' || stopped || s.cur?.done || s.cur?.failed) {
        if (s.cur && personTurn(s.cur)) park(s, s.cur)
        s.cur = newRun(at)
      }
      s.cur ??= newRun(at)
      Object.assign(s.cur, { skill: name, stage: null, why: null, failed: false, done: false, running: true, since: at })
      s.asking = null
      return
    }
    case 'stage': {
      if (!optNum(ev.issue)) return
      const m = ev.issue ?? s.cur?.issue ?? null
      s.cur ??= newRun(at)
      if (m !== null) focus(s, m, at)
      if (ev.ok === true && STAGES.includes(ev.stage)) {
        Object.assign(s.cur, { stage: ev.stage, why: String(ev.why ?? ''), failed: false })
        if (ev.stage === 'done') {
          s.cur.done = true
          if (m !== null) takeWaiting(s, m)
        }
      } else s.cur.failed = true
      s.asking = null
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
    case 'ask':
      if (typeof ev.id === 'string' && ev.id && s.cur) s.asking = ev.id
      return
    case 'ran':
      if (s.asking !== null && s.asking === ev.id) s.asking = null
      return
    case 'turnStart':
      s.asking = null
      if (s.cur?.done) s.cur = s.waiting.pop() ?? null
      // A skill's own row (no stage since it started) goes on: the person answered it.
      else if (s.cur?.skill && s.cur.stage === null && !s.cur.failed) s.cur.running = true
      return
    case 'turnEnd':
      s.asking = null
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

// D15: the links of the row a Run shows, by the stage or skill it is about; an id not
// observed leaves its link out.
const linksOf = (cur, key, base) => {
  if (!base) return []
  const names = cur.verdictResult === 'NEEDS-FIX' && NEEDS_FIX.includes(key) ? ['verdict', 'pr'] : LINKS[key] ?? []
  const issue = posInt(cur.issue) ? cur.issue : null
  const pr = posInt(cur.pr) ? cur.pr : null
  const make = {
    issue: () => issue && { label: `#${issue}`, href: `${base}/issues/${issue}` },
    spec: () => issue && posInt(cur.spec) && { label: 'spec', href: `${base}/issues/${issue}#issuecomment-${cur.spec}` },
    pr: () => pr && { label: `PR #${pr}`, href: `${base}/pull/${pr}` },
    verdict: () => pr && posInt(cur.verdict) && { label: 'verdict', href: `${base}/pull/${pr}#issuecomment-${cur.verdict}` },
  }
  return names.map((n) => make[n]()).filter(Boolean)
}

export function band(state, opts) {
  try {
    const cur = isObj(state) && isObj(state.cur) ? state.cur : null
    if (!cur) return null
    const { isWorking = false, now = 0, repo = null } = isObj(opts) ? opts : {}
    const waiting = Array.isArray(state.waiting) ? state.waiting.filter(isObj) : []
    const hasIssue = posInt(cur.issue)
    // The stage or skill the row is about: a working next is about its Issue's stage.
    const doing = cur.skill === 'next' || !cur.skill ? cur.stage : cur.skill
    let row, key = null, fromPerson = false
    if (typeof state.asking === 'string') {
      row = { tone: 'you', head: cur.skill ?? 'next', action: 'approve the tool call' }
      key = doing
    } else if (cur.failed) row = { tone: 'unknown', head: 'stage check failed', action: '/macro-loop:status' }
    else if (cur.done) row = { tone: 'done', head: 'done', final: true }
    else if (cur.running && isWorking) {
      row = { tone: 'run', head: cur.skill ?? 'next', time: since(cur, now, false) }
      if (posInt(cur.pr)) row.pr = `PR #${cur.pr}`
      if (Number.isInteger(cur.round)) row.round = `round ${cur.round}`
      key = doing
    } else {
      row = personRow(cur, now)
      key = cur.stage ?? cur.skill
      fromPerson = true
    }
    const links = linksOf(cur, key, repoBase(repo))
    // The PR number moves out of the text into its link (D6 changed).
    if (links.some((l) => l.label.startsWith('PR #'))) {
      delete row.pr
      if (fromPerson && key === 'merge') row.action = 'read verdict, merge the PR'
    }
    const parts = [{ text: SYMBOL[row.tone], rank: 0 }]
    if (hasIssue) parts.push({ text: `#${cur.issue}`, rank: 0 })
    parts.push({ text: row.head, rank: hasIssue ? 6 : 0 })
    if (row.action) parts.push({ text: row.action, rank: 5 })
    if (row.pr) parts.push({ text: row.pr, rank: 4 })
    if (row.round) parts.push({ text: row.round, rank: 3 })
    if (row.time) parts.push({ text: row.time, rank: 2 })
    const w = waiting.at(-1)
    if (w && !row.final) parts.push({ text: `+${waiting.length} waiting (#${w.issue} ${w.stage ?? w.skill ?? 'next'})`, rank: 1 })
    return { tone: row.tone, parts, links }
  } catch {
    return null
  }
}

const join = (parts, kept) => {
  // The symbol, the number and the head are joined by spaces, the rest by ' · '.
  const lead = /^#\d+$/.test(parts[1]?.text ?? '') ? 3 : 2
  const head = parts.slice(0, lead).filter((_, i) => kept[i]).map((p) => p.text)
  const tail = parts.slice(lead).filter((_, i) => kept[i + lead]).map((p) => p.text)
  return [head.join(' '), ...tail].join(SEP)
}

// What fits in `columns`: the band text and the links drawn after it, ' · ' between them.
function layout(b, columns) {
  if (!isObj(b) || !Array.isArray(b.parts)) return { text: '', links: [] }
  const parts = b.parts.filter(isObj).map((p) => ({ text: clean(p.text), rank: Number.isFinite(p.rank) ? p.rank : 0 }))
  const links = (Array.isArray(b.links) ? b.links : [])
    .filter((l) => isObj(l) && typeof l.href === 'string' && l.href)
    .map((l) => ({ label: clean(l.label), href: l.href }))
  const n = parts.length
  // Links go after the round and before the action, the rightmost first; '#<n>' stays.
  const all = [...parts, ...links.map((l, i) => ({ text: l.label, rank: /^#\d+$/.test(l.label) ? 0 : 4 + (links.length - 1 - i) / 100 }))]
  const kept = all.map(() => true)
  const max = typeof columns === 'number' && !Number.isNaN(columns) ? columns : Infinity
  const shown = () => [join(parts, kept), ...all.slice(n).filter((_, i) => kept[n + i]).map((p) => p.text)].join(SEP)
  while ([...shown()].length > max) {
    let drop = -1
    // Rank 1 (the counter) goes first and rank 6 (the head) last; rank 0 stays.
    all.forEach((p, i) => { if (kept[i] && p.rank > 0 && (drop < 0 || p.rank < all[drop].rank)) drop = i })
    if (drop < 0) break
    kept[drop] = false
  }
  return { text: join(parts, kept), links: links.filter((_, i) => kept[n + i]) }
}

// The band as one line of text, links by their labels.
export function fit(b, columns) {
  try {
    const { text, links } = layout(b, columns)
    return [text, ...links.map((l) => l.label)].join(SEP)
  } catch {
    return ''
  }
}

export function render(state, opts) {
  try {
    const o = isObj(opts) ? opts : {}
    const b = band(state, o)
    if (!b) return null
    const { text, links } = layout(b, o.columns)
    return { text, links, tone: b.tone }
  } catch {
    return null
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
    if (!isObj(state) || !isObj(state.cur)) return ''
    const at = (isWorking) => {
      const r = render(state, { isWorking, now, columns: Infinity, repo })
      return r?.links.length ? [r.text, ...r.links.map((l) => l.href)] : r?.text ?? ''
    }
    return JSON.stringify([at(true), at(false)])
  } catch {
    return ''
  }
}
