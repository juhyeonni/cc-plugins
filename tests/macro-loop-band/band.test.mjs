import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MOD = join(ROOT, 'plugins/macro-loop-band/hooks/band.mjs')
const { SKILLS, STAGES, TRACK, COLUMNS, MAX_ROWS, initial, reduce, rows, layout, render, lines, track, elapsed, clean, signature, repoOf } =
  await import(pathToFileURL(MOD).href)

const MIN = 60_000
const WIDE = 200

// Event builders, shaped as the glue sends them.
const skill = (name, at = 0) => ({ type: 'skill', skill: `macro-loop:${name}`, at })
const stage = (issue, s, at = 0, why = '') => ({ type: 'stage', issue, ok: true, stage: s, why, at })
const failed = (issue, at = 0) => ({ type: 'stage', issue, ok: false, at })
const trust = (pr, round, issue, at = 0) => ({ type: 'trust', pr, round, issue, at })
const turnStart = (at = 0) => ({ type: 'turnStart', at })
const turnEnd = (at = 0) => ({ type: 'turnEnd', at })
// trust.mjs output as the glue normalizes it: spec undefined when the output had no Issue.
const trustFull = (o, at = 0) => ({ type: 'trust', round: null, issue: null, at, ...o })
const run = (events, s = initial()) => events.reduce(reduce, s)
// The first row, before layout, and the band as text lines.
const row = (s, now, isWorking, o = {}) => rows(s, { now, isWorking, ...o })?.[0] ?? null
const working = (s, now, o) => row(s, now, true, o)
const idle = (s, now, o) => row(s, now, false, o)
const text = (s, now, isWorking, o = {}) => lines(render(s, { now, isWorking, columns: WIDE, ...o }))
const pick = (r) => r && { tone: r.tone, stage: r.stage, action: r.action, track: r.track, round: r.round, time: r.time }

test('constants: the skills, stages, track cells and columns the band knows', () => {
  assert.deepEqual(SKILLS, ['next', 'triage', 'grilling', 'spec', 'implement', 'open-pr', 'verify'])
  assert.deepEqual(STAGES, ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'resumable', 'wait', 'merge', 'stop', 'done'])
  assert.deepEqual(TRACK, ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'merge'])
  assert.deepEqual(COLUMNS, ['symbol', 'number', 'track', 'stage', 'action', 'round', 'time', 'links'])
  assert.equal(MAX_ROWS, 4)
  assert.deepEqual(initial(), { cur: null, waiting: [] })
})

test('AC7: each Band row comes from its events', async (t) => {
  await t.test('claude working: no action', () => {
    const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trust(109, 2, 12, 3 * MIN)])
    assert.deepEqual(pick(working(s, 16 * MIN)), { tone: 'run', stage: 'verify', action: undefined, track: '●●●●◐○', round: 'r2', time: '14m' })
    assert.deepEqual(text(s, 16 * MIN, true), ['▶ #12 ●●●●◐○ verify r2 14m'])
  })
  await t.test('interview waiting on the person', () => {
    const s = run([skill('next', 0), stage(108, 'grilling', 1, 'a decision is needed'), turnEnd(2 * MIN)])
    assert.deepEqual(pick(idle(s, 5 * MIN)), { tone: 'you', stage: 'grilling', action: 'answer Qs', track: '●◐○○○○', round: '', time: '3m' })
  })
  await t.test('grilling skill with no stage', () => {
    const s = run([skill('next', 0), stage(108, 'implement', 1), skill('grilling', 2), turnEnd(3)])
    assert.equal(idle(s, MIN).action, 'answer Qs')
    assert.equal(idle(s, MIN).stage, 'grilling')
    assert.equal(idle(s, MIN).track, '●◐○○○○')
  })
  await t.test('PASS: merge the PR', () => {
    const s = run([skill('verify', 0), trust(109, 1, 12, 1), stage(12, 'merge', 2, 'the verdict for the current head is PASS'), turnEnd(3)])
    assert.deepEqual(pick(idle(s, MIN)), { tone: 'you', stage: 'merge', action: 'merge the PR', track: '●●●●●◐', round: 'r1', time: '0m' })
    assert.deepEqual(text(s, MIN, false), ['◆ #12 ●●●●●◐ merge merge the PR r1 0m'])
  })
  await t.test('stop, with each short reason, at the last stage seen', () => {
    const at = (why) => idle(run([skill('next', 0), stage(12, 'verify', 1), stage(12, 'stop', 2, why), turnEnd(3)]), MIN)
    assert.equal(at('3 verdicts and the newest is NEEDS-FIX').action, 'decide: NEEDS-FIX 3×')
    assert.equal(at('more than one state label: ready, needsInfo').action, 'decide: state labels conflict')
    assert.equal(at('no rule fits: states=[] priority=true').action, 'decide: no rule fits')
    assert.equal(at('something new \u001b[31m').action, 'decide: see /macro-loop:status')
    assert.equal(at('x').stage, 'verify')
    assert.equal(at('x').track, '●●●●◐○')
    // No stage seen before the stop: no track, and the stage reads stop.
    const bare = idle(run([skill('next', 0), stage(12, 'stop', 1, 'x'), turnEnd(2)]), MIN)
    assert.equal(bare.stage, 'stop')
    assert.equal(bare.track, '')
  })
  await t.test('a skill asked a question, the turn ended', () => {
    const s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), turnEnd(10 * MIN)])
    assert.deepEqual(pick(idle(s, 13 * MIN)), { tone: 'you', stage: 'implement', action: 'answer above', track: '●●◐○○○', round: '', time: '3m' })
  })
  await t.test('resumable', () => {
    const s = run([skill('next', 0), stage(93, 'resumable', 1), turnEnd(2)])
    assert.deepEqual(pick(idle(s, 2)), { tone: 'you', stage: 'triage', action: 'read reply', track: '◐○○○○○', round: '', time: '0m' })
  })
  await t.test('wait', () => {
    const s = run([skill('next', 0), stage(101, 'wait', 1), turnEnd(5 * MIN)])
    assert.deepEqual(pick(idle(s, 125 * MIN)), { tone: 'other', stage: 'triage', action: '(requester)', track: '◐○○○○○', round: '', time: '2h' })
    assert.deepEqual(text(s, 125 * MIN, false), ['◇ #101 ◐○○○○○ triage (requester) 2h'])
  })
  await t.test('stage.mjs failed', () => {
    const s = run([skill('next', 0), stage(12, 'verify', 1), failed(12, 2)])
    for (const w of [true, false]) {
      const r = row(s, MIN, w)
      assert.deepEqual([r.tone, r.stage, r.action, r.track], ['unknown', 'verify', 'run /macro-loop:status', '●●●●◐○'])
    }
    assert.deepEqual(text(s, MIN, false), ['? #12 ●●●●◐○ verify run /macro-loop:status'])
  })
  await t.test('done, then gone at the next turn', () => {
    const s = run([skill('next', 0), stage(12, 'done', 1), turnEnd(2)])
    assert.deepEqual(text(s, MIN, false), ['✓ #12 ●●●●●● merge'])
    assert.deepEqual(text(s, MIN, true), ['✓ #12 ●●●●●● merge'])
    assert.equal(render(reduce(s, turnStart(3)), { isWorking: true, now: MIN, columns: WIDE }), null)
  })
  await t.test('a skill with no Issue', () => {
    const s = run([skill('verify', 0)])
    assert.deepEqual(text(s, 3 * MIN, true), ['▶ ●●●●◐○ verify 3m'])
    assert.deepEqual(text(run([skill('next', 0)]), 3 * MIN, true), ['▶ next 3m'])
  })
  await t.test('tones follow the symbol', () => {
    const s = run([skill('next', 0), stage(12, 'merge', 1)])
    assert.equal(working(s, 0).tone, 'run')
    assert.equal(idle(s, 0).tone, 'you')
    assert.equal(idle(run([skill('next', 0), failed(12, 1)]), 0).tone, 'unknown')
  })
})

test('AC8: open-pr or verify after implement moves the ▶ row with no stage.mjs call', () => {
  let s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2)])
  assert.deepEqual(pick(working(s, 2 + 5 * MIN)), { tone: 'run', stage: 'implement', action: undefined, track: '●●◐○○○', round: '', time: '5m' })
  s = reduce(s, skill('open-pr', 10 * MIN))
  assert.deepEqual([working(s, 11 * MIN).stage, working(s, 11 * MIN).track, working(s, 11 * MIN).time], ['open-pr', '●●●◐○○', '1m'])
  s = reduce(s, { type: 'pr', pr: 109, at: 11 * MIN })
  s = reduce(s, skill('verify', 12 * MIN))
  assert.deepEqual([working(s, 12 * MIN).stage, working(s, 12 * MIN).track], ['verify', '●●●●◐○'])
  assert.equal(s.cur.pr, 109)
})

test('D8: a turn after a skill asked returns to ▶ while Claude works', () => {
  let s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), turnEnd(MIN), turnStart(20 * MIN)])
  assert.deepEqual([working(s, 21 * MIN).tone, working(s, 21 * MIN).time], ['run', '20m'])
  s = reduce(s, turnEnd(22 * MIN))
  assert.deepEqual([idle(s, 25 * MIN).action, idle(s, 25 * MIN).time], ['answer above', '3m'])
  // A stage-derived ◆ row stays while Claude works on something else.
  const m = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(MIN), turnStart(2 * MIN)])
  assert.equal(working(m, 3 * MIN).action, 'merge the PR')
})

test('D10: a skill after a ◆ merge row starts a new run and keeps the Issue as a row', () => {
  const base = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2), turnStart(3)])
  for (const name of ['grilling', 'triage', 'spec']) {
    const s = reduce(base, skill(name, 4))
    assert.equal(s.cur.issue, null, name)
    assert.deepEqual(s.waiting.map((w) => w.issue), [12], name)
    const rs = rows(s, { isWorking: true, now: 4 + MIN })
    assert.deepEqual(rs.map((r) => [r.tone, r.issue, r.stage]), [['run', null, name], ['you', 12, 'merge']], name)
  }
})

test('AC9: events with an agentId leave the state unchanged', () => {
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2)])
  const events = [skill('implement', 3), stage(13, 'merge', 3), failed(12, 3), trust(110, 3, 14, 3), { type: 'pr', pr: 111, at: 3 }, turnEnd(3)]
  for (const ev of events) assert.equal(reduce(s, { ...ev, agentId: 'a1' }), s, ev.type)
  // Garbage is ignored too.
  for (const ev of [null, 42, 'x', {}, { type: 'nope', at: 1 }, stage(-1, 'merge'), stage(1.5, 'merge'), stage('12', 'merge'),
    stage(Infinity, 'merge'), { type: 'pr', pr: 0, at: 1 }, trust(NaN, 1, 12), { type: 'skill', skill: 'other:verify', at: 1 },
    { type: 'skill', skill: 'macro-loop:status', at: 1 }, { type: 'skill', skill: 'verify', at: 1 }, { type: 'skill', skill: 7, at: 1 }])
    assert.equal(reduce(s, ev), s, JSON.stringify(ev))
  assert.doesNotThrow(() => reduce(null, skill('next')))
  assert.doesNotThrow(() => reduce({ cur: 'x', waiting: 5 }, stage(12, 'merge')))
})

test('AC10: a failed stage check gives ? and keeps the Issue number', () => {
  const s = run([skill('next', 0), stage(12, 'verify', 1)])
  for (const ev of [failed(null, 2), failed(12, 2), stage(12, 'bogus', 2)]) {
    const r = idle(reduce(s, ev), MIN)
    assert.deepEqual([r.tone, r.issue], ['unknown', 12], JSON.stringify(ev))
  }
  // A good check afterwards recovers.
  assert.equal(idle(run([failed(12, 2), stage(12, 'merge', 3)], s), MIN).action, 'merge the PR')
})

test('AC11: a tool.check ask leaves the band unchanged (D9 removed)', () => {
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2)])
  for (const ev of [{ type: 'ask', id: 'toolu_1', at: 3 }, { type: 'ran', id: 'toolu_1', at: 4 }]) assert.equal(reduce(s, ev), s, ev.type)
  assert.deepEqual(reduce(initial(), { type: 'ask', id: 'toolu_1', at: 1 }), initial())
})

test('AC12: a ◆ row survives unrelated turns, and another Issue adds a row first', () => {
  let s = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2 * MIN)])
  for (const ev of [turnStart(3 * MIN), turnEnd(4 * MIN), turnStart(5 * MIN), turnEnd(6 * MIN)]) {
    assert.equal(reduce(s, ev), s, ev.type)
    s = reduce(s, ev)
  }
  assert.equal(idle(s, 9 * MIN).action, 'merge the PR')
  // stage.mjs for another Issue in the same next run: both rows, the new one first.
  s = run([skill('next', 10 * MIN), stage(12, 'merge', 10 * MIN), stage(93, 'resumable', 11 * MIN), turnEnd(11 * MIN)])
  assert.deepEqual(rows(s, { now: 12 * MIN }).map((r) => [r.issue, r.action]), [[93, 'read reply'], [12, 'merge the PR']])
  // A third Issue: the others follow, oldest first.
  s = run([turnStart(12 * MIN), skill('next', 12 * MIN), stage(108, 'grilling', 12 * MIN), turnEnd(13 * MIN)], s)
  assert.deepEqual(rows(s, { now: 14 * MIN }).map((r) => r.issue), [108, 12, 93])
  // Back to a waiting Issue: it leaves its place and comes first; done, it goes at the next turn.
  s = run([turnStart(15 * MIN), skill('next', 15 * MIN), stage(12, 'done', 16 * MIN)], s)
  assert.deepEqual(rows(s, { now: 16 * MIN }).map((r) => [r.issue, r.tone]), [[12, 'done'], [93, 'you'], [108, 'you']])
  s = reduce(s, turnStart(17 * MIN))
  assert.deepEqual(rows(s, { now: 17 * MIN }).map((r) => r.issue), [108, 93])
  // A wait row counts too.
  const w = run([skill('next', 0), stage(101, 'wait', 1), stage(12, 'merge', 2), turnEnd(3)])
  assert.deepEqual(rows(w, { now: MIN }).map((r) => [r.issue, r.tone]), [[12, 'you'], [101, 'other']])
  // One row per Issue.
  const d = run([skill('next', 0), stage(12, 'merge', 1), stage(13, 'merge', 2), stage(12, 'stop', 3, '3 verdicts'), stage(13, 'merge', 4)])
  assert.deepEqual(d.waiting.map((x) => x.issue), [12])
  assert.equal(d.waiting[0].stage, 'stop')
})

test('AC12: a skill with no Issue adopts one, merging its waiting entry', () => {
  let s = run([skill('next', 0), trust(109, 2, 12, 1), stage(12, 'merge', 2), skill('next', 3)])
  assert.equal(s.cur.issue, null)
  assert.deepEqual(s.waiting.map((w) => w.issue), [12])
  s = run([skill('verify', 4), stage(12, 'verify', 5)], s)
  assert.equal(s.waiting.length, 0)
  assert.deepEqual(pick(working(s, 5 + MIN)), { tone: 'run', stage: 'verify', action: undefined, track: '●●●●◐○', round: 'r2', time: '1m' })
})

test('AC13: session end for clear or resume clears every row', () => {
  const s = run([skill('next', 0), stage(12, 'merge', 1), stage(93, 'resumable', 2)])
  for (const reason of ['clear', 'resume']) {
    const e = reduce(s, { type: 'sessionEnd', reason, at: 4 })
    assert.deepEqual(e, initial())
    assert.equal(render(e, { isWorking: false, now: 5, columns: WIDE }), null)
  }
  for (const reason of ['logout', 'prompt_input_exit', 'other', undefined]) assert.equal(reduce(s, { type: 'sessionEnd', reason, at: 4 }), s)
})

// D15: links to the GitHub objects the next action needs.
const REPO = { owner: 'o', repo: 'r' }
const GH = 'https://github.com/o/r'
const SPEC = 6018031462
const VERDICT = 777
const labels = (s, o) => rows(s, { now: 0, ...o, repo: REPO })[0].links.map((l) => l.label)

// Four Issues: ▶ #12 verifying with two links, ◆ #7 at merge with two, ◆ #108 grilling, ◆ #93 new reply.
const four = () => run([
  skill('next', 0), trustFull({ pr: 110, issue: 7, spec: 5, round: 3, verdict: 9, verdictResult: 'PASS' }, 0), stage(7, 'merge', 0), turnEnd(0),
  skill('next', 10 * MIN), stage(108, 'grilling', 10 * MIN), turnEnd(10 * MIN),
  skill('next', 10 * MIN), stage(93, 'resumable', 10 * MIN), turnEnd(10 * MIN),
  skill('next', 20 * MIN), stage(12, 'verify', 20 * MIN), skill('verify', 20 * MIN), trustFull({ pr: 109, issue: 12, spec: SPEC, round: 2 }, 20 * MIN),
])

test('AC14: as the band narrows, whole columns drop in order and the rest line up', () => {
  const s = four()
  const o = { isWorking: true, now: 34 * MIN, repo: REPO }
  const full = render(s, { ...o, columns: Infinity })
  assert.deepEqual(lines(full), [
    '▶ #12  ●●●●◐○ verify                r2 14m    PR #109 · spec',
    '◆ #7   ●●●●●◐ merge    merge the PR r3 34m    PR #110 · verdict',
    '◆ #108 ●◐○○○○ grilling answer Qs       24m',
    '◆ #93  ◐○○○○○ triage   read reply      24m',
  ])
  const seen = []
  for (let c = 80; c >= 0; c--) {
    const laid = render(s, { ...o, columns: c })
    const cols = laid.columns.map((x) => x.name)
    const nLinks = Math.max(...laid.rows.map((r) => r.cells.find((x) => x.col === 'links')?.links.length ?? 0))
    const key = `${cols.join(',')}:${nLinks}`
    if (seen.at(-1) !== key) seen.push(key)
    // Symbol, number and stage are never dropped, and every row lines up with the columns.
    for (const keep of ['symbol', 'number', 'stage']) assert.ok(cols.includes(keep), `${c}: ${keep}`)
    const out = lines(laid)
    let offset = 0
    for (const col of laid.columns) {
      for (const [i, r] of laid.rows.entries()) {
        const cell = r.cells.find((x) => x.col === col.name)
        if (cell.text) assert.equal(out[i].slice(offset, offset + cell.text.length), cell.text, `${c}: ${col.name} row ${i}`)
      }
      offset += col.width + 1
    }
    if (c >= 20) for (const l of out) assert.ok([...l].length <= c, `${c}: ${l}`)
  }
  assert.deepEqual(seen, [
    'symbol,number,track,stage,action,round,time,links:2',
    'symbol,number,track,stage,action,time,links:2',
    'symbol,number,track,stage,action,links:2',
    'symbol,number,track,stage,links:2',
    'symbol,number,track,stage,links:1',
    'symbol,number,track,stage:0',
    'symbol,number,stage:0',
  ])
  // A cell that grows keeps its own column: the links do not move when the time does.
  const at = (now) => lines(render(s, { ...o, now, columns: Infinity }))[0].indexOf('PR #109')
  assert.equal(at(21 * MIN), at(20 * MIN + 75 * MIN))
  assert.doesNotThrow(() => layout(null, 10))
  assert.equal(layout([], 10), null)
})

test('AC15: elapsed reads in whole minutes and hours, and moves on the timer alone', () => {
  assert.equal(elapsed(0), '0m')
  assert.equal(elapsed(59_999), '0m')
  assert.equal(elapsed(14 * MIN + 30_000), '14m')
  assert.equal(elapsed(59 * MIN), '59m')
  assert.equal(elapsed(60 * MIN), '1h')
  assert.equal(elapsed(65 * MIN), '1h5m')
  assert.equal(elapsed(120 * MIN), '2h')
  assert.equal(elapsed(-5), '0m')
  assert.equal(elapsed(NaN), '0m')
  assert.equal(elapsed('x'), '0m')
  const s = run([skill('verify', 0)])
  assert.equal(signature(s, 10_000), signature(s, 50_000))
  assert.notEqual(signature(s, 50_000), signature(s, MIN))
  assert.equal(working(s, MIN).time, '1m')
})

test('AC16: with no macro-loop activity nothing is drawn', () => {
  const quiet = run([turnStart(1), { type: 'ask', id: 't', at: 2 }, { type: 'ran', id: 't', at: 3 }, { type: 'pr', pr: 5, at: 4 },
    trust(5, 1, 3, 5), turnEnd(6), { type: 'skill', skill: 'other:verify', at: 7 }, { type: 'sessionEnd', reason: 'clear', at: 8 }])
  assert.deepEqual(quiet, initial())
  assert.equal(rows(quiet, { isWorking: true, now: 9 }), null)
  assert.equal(render(quiet, { isWorking: false, now: 9, columns: WIDE }), null)
  assert.equal(signature(quiet, 9), '')
  assert.equal(render(null, { isWorking: false, now: 9, columns: WIDE }), null)
  assert.deepEqual(lines(null), [])
})

test('reduce never mutates its arguments and returns the same state when nothing changes', () => {
  const s = run([skill('next', 0), stage(12, 'merge', 1), stage(13, 'resumable', 2)])
  const copy = JSON.parse(JSON.stringify(s))
  const evs = [skill('verify', 3), stage(12, 'stop', 4), failed(null, 5), trust(1, 1, 14, 6), turnEnd(8), turnStart(9),
    { type: 'sessionEnd', reason: 'clear', at: 10 }]
  for (const ev of evs) reduce(s, Object.freeze({ ...ev }))
  assert.deepEqual(s, copy)
  assert.equal(reduce(s, stage(13, 'resumable', 99)), s)
  assert.equal(reduce(initial(), { type: 'sessionEnd', reason: 'clear', at: 1 }).cur, null)
})

test('clean strips control and invisible characters from every cell', () => {
  assert.equal(clean('a\u0000b\u001b[31mc\u007f\u0085\u200b\u200f\u2028\u202e\u2060\u2066\u2069\ufeffd'), 'ab[31mcd')
  assert.equal(clean(12), '12')
  assert.equal(clean({ toString() { throw new Error('x') } }), '')
  const laid = layout([{ tone: 'you', issue: 1, stage: 'x\u202ey', action: 'a\u0000b', links: [{ label: 'p\u2066q', href: 'h' }] }], 50)
  assert.deepEqual(lines(laid), ['◆ #1 xy ab pq'])
})

test('AC19: each stage D15 lists carries its links in order, built from the remote', async (t) => {
  await t.test('triage and grilling rows carry none: the number is the Issue link', () => {
    for (const st of ['triage', 'grilling']) {
      const r = rows(run([skill('next', 0), stage(7, st, 1), turnEnd(2)]), { now: 0, repo: REPO })[0]
      assert.deepEqual(r.links, [], st)
      assert.equal(r.href, `${GH}/issues/7`, st)
    }
  })
  await t.test('spec and implement link the spec comment', () => {
    const sp = run([skill('spec', 0), trustFull({ issue: 12, spec: SPEC }, 1)])
    assert.deepEqual(rows(sp, { isWorking: true, now: 0, repo: REPO })[0].links, [{ label: 'spec', href: `${GH}/issues/12#issuecomment-${SPEC}` }])
    const im = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), trustFull({ issue: 12, spec: SPEC }, 3)])
    assert.deepEqual(labels(im, { isWorking: true }), ['spec'])
    assert.deepEqual(labels(reduce(im, turnEnd(4))), ['spec'])
  })
  await t.test('open-pr and verify link the PR, then the spec', () => {
    const base = [skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), trustFull({ issue: 12, spec: SPEC }, 3)]
    const op = run([...base, skill('open-pr', 4), { type: 'pr', pr: 109, at: 5 }])
    assert.deepEqual(rows(op, { isWorking: true, now: 0, repo: REPO })[0].links, [
      { label: 'PR #109', href: `${GH}/pull/109` },
      { label: 'spec', href: `${GH}/issues/12#issuecomment-${SPEC}` },
    ])
    const v = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC }, 3 * MIN)])
    assert.deepEqual(labels(v, { isWorking: true }), ['PR #109', 'spec'])
  })
  await t.test('NEEDS-FIX links the verdict, then the PR', () => {
    const nf = trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3)
    const im = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), nf])
    assert.deepEqual(rows(im, { isWorking: true, now: 0, repo: REPO })[0].links, [
      { label: 'verdict', href: `${GH}/pull/109#issuecomment-${VERDICT}` },
      { label: 'PR #109', href: `${GH}/pull/109` },
    ])
    const st = run([skill('next', 0), nf, stage(12, 'stop', 4, '3 verdicts and the newest is NEEDS-FIX'), turnEnd(5)])
    assert.deepEqual(labels(st), ['verdict', 'PR #109'])
  })
  await t.test('PASS links the PR, then the verdict', () => {
    const s = run([skill('verify', 0), trustFull({ pr: 109, round: 1, issue: 12, spec: SPEC, verdict: VERDICT, verdictResult: 'PASS' }, 1),
      stage(12, 'merge', 2, 'the verdict for the current head is PASS'), turnEnd(3)])
    assert.deepEqual(rows(s, { now: 0, repo: REPO })[0].links, [
      { label: 'PR #109', href: `${GH}/pull/109` },
      { label: 'verdict', href: `${GH}/pull/109#issuecomment-${VERDICT}` },
    ])
  })
  await t.test('rows D15 does not list carry none', () => {
    for (const [st, why] of [['resumable', ''], ['wait', ''], ['stop', 'no rule fits']]) {
      const s = run([skill('next', 0), trustFull({ issue: 12, spec: SPEC, pr: 109 }, 1), stage(12, st, 2, why), turnEnd(3)])
      assert.deepEqual(labels(s), [], st)
    }
    assert.deepEqual(labels(run([skill('next', 0), failed(12, 1)])), [])
    assert.deepEqual(labels(run([skill('next', 0), stage(12, 'done', 1)])), [])
  })
})

test('AC20: an id not observed leaves its link out and the others stay', () => {
  const v = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ pr: 109, round: 1 }, 3)])
  assert.deepEqual(labels(v, { isWorking: true }), ['PR #109'])
  const p = run([skill('next', 0), trustFull({ pr: 109, issue: 12, spec: null, verdict: null, verdictResult: 'PASS' }, 1), stage(12, 'merge', 2), turnEnd(3)])
  assert.deepEqual(labels(p), ['PR #109'])
  assert.deepEqual(labels(run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2)])), [])
  assert.deepEqual(labels(run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2)]), { isWorking: true }), [])
  assert.deepEqual(labels(run([skill('spec', 0)]), { isWorking: true }), [])
  // trust.mjs --pr with no Issue keeps the spec seen before; a spec of null clears it.
  const kept = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ issue: 12, spec: SPEC }, 3), trustFull({ pr: 109 }, 4)])
  assert.deepEqual(labels(kept, { isWorking: true }), ['PR #109', 'spec'])
  assert.deepEqual(labels(reduce(kept, trustFull({ issue: 12, spec: null }, 5)), { isWorking: true }), ['PR #109'])
  // A new PR drops the old PR's verdict.
  const moved = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2),
    trustFull({ pr: 109, issue: 12, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3), { type: 'pr', pr: 110, at: 4 }])
  assert.equal(moved.cur.pr, 110)
  assert.deepEqual(labels(moved, { isWorking: true }), [])
  // Garbage ids are not observed.
  const g = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ pr: 109, issue: 12, spec: -1, verdict: 1.5, verdictResult: 'MAYBE' }, 3)])
  assert.deepEqual(labels(g, { isWorking: true }), ['PR #109'])
  assert.equal(g.cur.verdictResult, null)
  for (const ev of [trustFull({ pr: NaN, issue: 12 }), trustFull({ pr: 109, issue: '12' }), trustFull({})]) assert.equal(reduce(g, ev), g, JSON.stringify(ev))
})

test('AC21: owner and repo come from https, git@ and ssh:// remotes; any other gives no links and a plain number', () => {
  for (const url of ['https://github.com/o/r.git', 'https://github.com/o/r', 'https://github.com/o/r/', 'git@github.com:o/r.git',
    'git@github.com:o/r', 'ssh://git@github.com/o/r', 'ssh://git@github.com/o/r.git', 'ssh://git@github.com:22/o/r',
    'https://token@github.com/o/r.git', ' https://github.com/o/r.git\r\n'])
    assert.deepEqual(repoOf(url), REPO, url)
  assert.deepEqual(repoOf('https://github.com/juhyeonni/cc-plugins.git'), { owner: 'juhyeonni', repo: 'cc-plugins' })
  for (const url of ['https://gitlab.com/o/r.git', 'http://github.com/o/r', 'git@gitlab.com:o/r.git', 'https://github.com/o',
    'https://github.com/o/r/x', 'https://github.com.evil.io/o/r', 'file:///c/repo', 'C:\\repo', '../r', '', 'https://github.com/o/..',
    'https://github.com/o/r\u001b]8;;x', 'https://github.com/o/r?x=1', null, undefined, 42, {}])
    assert.equal(repoOf(url), null, String(url))
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC }, 3 * MIN)])
  const o = { isWorking: true, now: 16 * MIN, columns: WIDE }
  for (const repo of [null, repoOf('https://gitlab.com/o/r.git'), undefined, 'o/r', { owner: 'o' }]) {
    const laid = render(s, { ...o, repo })
    assert.deepEqual(lines(laid), ['▶ #12 ●●●●◐○ verify r2 14m'], String(repo))
    assert.equal(laid.rows[0].cells.find((c) => c.col === 'number').href, undefined, String(repo))
    assert.equal(signature(s, 16 * MIN, repo), signature(s, 16 * MIN))
  }
  // With a remote the signature changes, so the glue redraws once the remote is read.
  assert.notEqual(signature(s, 16 * MIN, REPO), signature(s, 16 * MIN))
})

test('AC22: every row\'s Issue number links to its Issue', () => {
  const laid = render(four(), { isWorking: true, now: 34 * MIN, repo: REPO, columns: WIDE })
  assert.deepEqual(laid.rows.map((r) => r.cells.find((c) => c.col === 'number').href),
    [12, 7, 108, 93].map((n) => `${GH}/issues/${n}`))
  // The number keeps its link at every width.
  for (let c = 0; c <= 80; c++) assert.equal(render(four(), { isWorking: true, now: 0, repo: REPO, columns: c }).rows[0].cells[1].href, `${GH}/issues/12`)
})

test('AC24: the track shows the D16 cells, moves back after NEEDS-FIX, and keeps its place on stop and a failed check', () => {
  assert.equal(track(null), '')
  assert.equal(track(-1), '')
  assert.equal(track(0), '◐○○○○○')
  assert.equal(track(6), '●●●●●●')
  const at = (st) => idle(run([skill('next', 0), stage(12, st, 1), turnEnd(2)]), MIN).track
  assert.deepEqual(['triage', 'wait', 'resumable', 'grilling', 'implement', 'open-pr', 'verify', 'merge'].map(at),
    ['◐○○○○○', '◐○○○○○', '◐○○○○○', '●◐○○○○', '●●◐○○○', '●●●◐○○', '●●●●◐○', '●●●●●◐'])
  // Skills move it while they run.
  assert.equal(working(run([skill('spec', 0)]), 0).track, '●◐○○○○')
  // A NEEDS-FIX verdict sends the Issue back to implement.
  const nf = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2),
    trustFull({ pr: 109, issue: 12, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3), turnEnd(4), turnStart(5), skill('implement', 6)])
  assert.equal(working(nf, 7).track, '●●◐○○○')
  // stop and a failed check keep the last position.
  const v = run([skill('next', 0), stage(12, 'open-pr', 1)])
  assert.equal(idle(run([stage(12, 'stop', 2, 'x'), turnEnd(3)], v), MIN).track, '●●●◐○○')
  assert.equal(idle(reduce(v, failed(12, 2)), MIN).track, '●●●◐○○')
  // done fills it.
  assert.equal(idle(reduce(v, stage(12, 'done', 2)), MIN).track, '●●●●●●')
})

test('AC25: past four Issues the band shows four rows and a +N more row', () => {
  const five = run([skill('next', 30 * MIN), stage(101, 'wait', 30 * MIN), turnEnd(30 * MIN)], four())
  assert.equal(rows(five, { now: 0 }).length, 5)
  const out = lines(render(five, { now: 31 * MIN, columns: WIDE }))
  assert.equal(out.length, 5)
  assert.equal(out[4], '+1 more · /macro-loop:status')
  assert.match(out[0], /^◇ #101/)
  const six = run([skill('next', 31 * MIN), stage(55, 'merge', 31 * MIN), turnEnd(31 * MIN)], five)
  assert.equal(lines(render(six, { now: 32 * MIN, columns: WIDE }))[4], '+2 more · /macro-loop:status')
  assert.equal(render(four(), { now: 0, columns: WIDE }).more, null)
})
