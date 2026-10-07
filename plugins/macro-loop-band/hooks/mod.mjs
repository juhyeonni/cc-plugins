// The band's glue (#108): turns the engine's events into band.mjs events, keeps the state in
// module memory, and draws AbovePrompt from render() as a table, one row per Issue (D3, D17).
// It only observes: every hook returns what its next(e) settled to, and a parse failure never
// changes that.
import { initial, reduce, render, repoOf, signature } from './band.mjs'

// Color only repeats the symbol; the stage, round and time are dim (D4).
const TONE = { run: 'suggestion', you: 'warning', other: 'inactive', unknown: 'error', done: 'success' }
const TONED = ['symbol', 'track', 'action']
const DIM = ['stage', 'round', 'time']

// Matched by script name, so any quoting of the path and any compound prefix still match.
const STAGE = /(?:^|[\s"'\/\\])stage\.mjs["']?\s+(?:[^|;&\n]*?\s)?--issue(?:=|\s+)["']?(\d+)/
const TRUST = /(?:^|[\s"'\/\\])trust\.mjs["']?\s+(?:[^|;&\n]*?\s)?--(?:pr|issue)(?:=|\s+)["']?\d+/
const GH_API = /\bgh\s+api\b/
const POST = /(?:-X\s*|--method[=\s]+)POST\b/
const PULLS = /repos\/\S+?\/pulls(?=["'\s]|$)/
const PR_URL = /\/pull\/(\d+)/

// Lost on a hot reload, and so is the timer, until the next event restarts it (D10).
let state = initial()
let lastSig = ''
let timer = null
// The origin remote's { owner, repo }, null when it is no GitHub remote (D15). Read once per
// session (and per load), at the first band drawn, so a session with no macro-loop activity
// runs nothing; not awaited, so no hook waits on git, and the band redraws once it is read.
let repo = null
let reading = null

function readRemote($) {
  reading ??= (async () => {
    try {
      // Absent, cwd is the session's anyway.
      const cwd = await $.session.cwd().catch(() => undefined)
      const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], cwd ? { cwd, timeoutMs: 5_000 } : { timeoutMs: 5_000 })
      repo = r.exitCode === 0 ? repoOf(r.stdout) : null
    } catch {
      repo = null
    }
    if (repo) await redraw($)
  })().catch(() => {})
}

async function feed($, ev) {
  const s = reduce(state, ev)
  if (s === state) return
  state = s
  await redraw($)
}

async function redraw($) {
  if ((await $.session.surfaces()).length === 0) return
  if (state.cur) readRemote($)
  if (!state.cur && timer) {
    timer.cancel()
    timer = null
  }
  // Started lazily: a reload drops timers and no session.start follows it.
  if (state.cur && !timer) timer = $.clock.every(60_000, () => { redraw($).catch(() => {}) })
  const sig = signature(state, await $.clock.now(), repo)
  if (sig === lastSig) return
  lastSig = sig
  $.ui.invalidate('ui.render')
}

// The last stdout line that parses as a JSON object passing `ok`, or null.
function lastJson(out, ok) {
  const lines = String(out).split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const o = JSON.parse(line)
      if (o && typeof o === 'object' && !Array.isArray(o) && ok(o)) return o
    } catch {}
  }
  return null
}

const num = (v) => (Number.isInteger(v) && v > 0 ? v : null)

// The band events one main-loop Bash call gives: a stage check, a trust check, a PR created.
function bashEvents(command, r, at) {
  const cmd = String(command ?? '')
  const out = typeof r.result?.stdout === 'string' ? r.result.stdout : (r.text ?? '')
  const evs = []
  const stage = cmd.match(STAGE)
  if (stage) {
    const issue = Number(stage[1])
    const o = r.isError ? null : lastJson(out, (x) => typeof x.stage === 'string')
    evs.push(o
      ? { type: 'stage', issue, ok: true, stage: o.stage, why: String(o.why ?? ''), at }
      : { type: 'stage', issue, ok: false, at })
  }
  const trust = !r.isError && cmd.match(TRUST)
  if (trust) {
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
    const o = lastJson(out, (x) => (isObj(x.pr) && num(x.pr.number) !== null) || (isObj(x.issue) && num(x.issue.number) !== null))
    if (o) {
      const pr = isObj(o.pr) ? o.pr : null
      const issue = isObj(o.issue) ? o.issue : null
      evs.push({
        type: 'trust', pr: num(pr?.number), round: pr?.round ?? null, issue: num(issue?.number) ?? num(pr?.closes),
        // undefined: the output named no Issue, so the spec seen before stays.
        spec: issue ? issue.spec ?? null : undefined,
        verdict: pr?.lastVerdict ?? null, verdictResult: pr?.lastVerdictResult ?? null, at,
      })
    }
  }
  if (!r.isError && GH_API.test(cmd) && POST.test(cmd) && PULLS.test(cmd)) {
    const text = String(out).trim()
    const m = text.match(PR_URL)
    const pr = m ? Number(m[1]) : /^\d+$/.test(text) ? Number(text) : null
    if (num(pr) !== null) evs.push({ type: 'pr', pr, at })
  }
  return evs
}

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    try {
      await feed($, { type: 'skill', skill: e.skill, at: await $.clock.now() })
    } catch {}
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const r = await next(e)
    try {
      const at = await $.clock.now()
      const r2 = /** @type {any} */ (r)
      // A backgrounded or interrupted command has no answer to read yet.
      if (e.tool === 'Bash' && r2.deny === undefined && !r2.result?.backgroundTaskId && r2.result?.interrupted !== true) {
        for (const ev of bashEvents(e.command, r2, at)) await feed($, ev)
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try {
      await feed($, { type: 'turnStart', at: await $.clock.now() })
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (!e.agentId) await feed($, { type: 'turnEnd', at: await $.clock.now() })
    } catch {}
    return next(e)
  })

  // A new session may run in another checkout: its remote is read afresh.
  on('session.start', async ($, e, next) => {
    reading = null
    repo = null
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      await feed($, { type: 'sessionEnd', reason: e.reason, at: await $.clock.now() })
    } catch {}
    return next(e)
  })

  // The engine keeps the last answer until invalidated, so the old band stays up meanwhile.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    let out = null
    try {
      out = render(state, { isWorking: e.props.isWorking, now: await $.clock.now(), columns: e.props.bodyColumns, repo })
    } catch {}
    if (!out) return next(e)
    const { Box, Link, Text } = $.ui.resolve(e)
    // Each column a fixed width, so a cell that grows never moves the next (D17). The stage
    // is dim beside the track; the symbol, track and action carry the row's tone (D4).
    const cell = (r, i, c, last) => {
      const key = `r${i}-${c.col}`
      const box = (child) => h(Box, last ? { key } : { key, width: c.width, flexShrink: 0 }, child)
      if (c.col === 'number' && c.href) return box(h(Link, { href: c.href, label: c.text }))
      if (c.col === 'links') {
        return box(h(Text, { wrap: 'truncate-end' }, ...c.links.flatMap((l, j) => [j ? ' · ' : '', h(Link, { href: l.href, label: l.label })])))
      }
      const style = DIM.includes(c.col) ? { dimColor: true } : TONED.includes(c.col) ? { color: TONE[r.tone] } : {}
      return box(h(Text, { ...style, wrap: 'truncate-end' }, c.text))
    }
    const rowsDrawn = out.rows.map((r, i) =>
      h(Box, { key: `r${i}`, flexDirection: 'row', columnGap: 1 }, ...r.cells.map((c, j) => cell(r, i, c, j === r.cells.length - 1))))
    if (out.more) rowsDrawn.push(h(Box, { key: 'more' }, h(Text, { dimColor: true, wrap: 'truncate-end' }, out.more)))
    return h(Box, { flexDirection: 'column' }, ...rowsDrawn)
  })
}
