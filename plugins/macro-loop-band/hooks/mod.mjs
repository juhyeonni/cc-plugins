// The band's glue (#108): turns the engine's events into band.mjs events, keeps the state in
// module memory, and draws AbovePrompt from render(). It only observes: every hook returns
// what its next(e) settled to, and a parse failure never changes that.
import { initial, reduce, render, signature } from './band.mjs'

// Color only repeats the symbol.
const TONE = { run: 'suggestion', you: 'warning', other: 'inactive', unknown: 'error', done: 'success' }

// Matched by script name, so any quoting of the path and any compound prefix still match.
const STAGE = /(?:^|[\s"'\/\\])stage\.mjs["']?\s+(?:[^|;&\n]*?\s)?--issue(?:=|\s+)["']?(\d+)/
const TRUST = /(?:^|[\s"'\/\\])trust\.mjs["']?\s+(?:[^|;&\n]*?\s)?--pr(?:=|\s+)["']?(\d+)/
const GH_API = /\bgh\s+api\b/
const POST = /(?:-X\s*|--method[=\s]+)POST\b/
const PULLS = /repos\/\S+?\/pulls(?=["'\s]|$)/
const PR_URL = /\/pull\/(\d+)/

// Lost on a hot reload, and so is the timer, until the next event restarts it (D10).
let state = initial()
let lastSig = ''
let timer = null

async function feed($, ev) {
  const s = reduce(state, ev)
  if (s === state) return
  state = s
  await redraw($)
}

async function redraw($) {
  if ((await $.session.surfaces()).length === 0) return
  if (!state.cur && timer) {
    timer.cancel()
    timer = null
  }
  // Started lazily: a reload drops timers and no session.start follows it.
  if (state.cur && !timer) timer = $.clock.every(60_000, () => { redraw($).catch(() => {}) })
  const sig = signature(state, await $.clock.now())
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
    const o = lastJson(out, (x) => x.pr && typeof x.pr === 'object' && num(x.pr.number) !== null)
    if (o) evs.push({ type: 'trust', pr: o.pr.number, round: o.pr.round ?? null, issue: o.pr.closes ?? o.issue?.number ?? null, at })
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
      if (e.tool_use_id) await feed($, { type: 'ran', id: e.tool_use_id, at })
      const r2 = /** @type {any} */ (r)
      // A backgrounded or interrupted command has no answer to read yet.
      if (e.tool === 'Bash' && r2.deny === undefined && !r2.result?.backgroundTaskId && r2.result?.interrupted !== true) {
        for (const ev of bashEvents(e.command, r2, at)) await feed($, ev)
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    try {
      if (!e.agentId && e.tool_use_id && v?.decision === 'ask') {
        await feed($, { type: 'ask', id: e.tool_use_id, at: await $.clock.now() })
      }
    } catch {}
    return v
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

  on('session.end', async ($, e, next) => {
    try {
      await feed($, { type: 'sessionEnd', reason: e.reason, at: await $.clock.now() })
    } catch {}
    return next(e)
  })

  // A progress row under the asked call means it was approved and runs. Only long Bash
  // calls draw one; any other asked call clears at tool.call's end.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    const id = e.props?.tool_use_id
    if (id && id === state.asking) {
      $.clock.now().then((at) => feed($, { type: 'ran', id, at })).catch(() => {})
    }
    return next(e)
  })

  // The engine keeps the last answer until invalidated, so the old band stays up meanwhile.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    let out = null
    try {
      out = render(state, { isWorking: e.props.isWorking, now: await $.clock.now(), columns: e.props.bodyColumns })
    } catch {}
    if (!out) return next(e)
    const { Text } = $.ui.resolve(e)
    return h(Text, { color: TONE[out.tone], wrap: 'truncate-end' }, out.text)
  })
}
