import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MOD = join(ROOT, 'plugins/macro-loop-band/hooks/band.mjs')
const { SKILLS, STAGES, initial, reduce, band, fit, render, elapsed, clean, signature, repoOf } = await import(
  pathToFileURL(MOD).href
)

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
const text = (s, now, isWorking) => render(s, { isWorking, now, columns: WIDE })?.text ?? null
const working = (s, now) => text(s, now, true)
const idle = (s, now) => text(s, now, false)

test('constants: the skills and stages the band knows', () => {
  assert.deepEqual(SKILLS, ['next', 'triage', 'grilling', 'spec', 'implement', 'open-pr', 'verify'])
  assert.deepEqual(STAGES, ['triage', 'grilling', 'implement', 'open-pr', 'verify', 'resumable', 'wait', 'merge', 'stop', 'done'])
  assert.deepEqual(initial(), { cur: null, waiting: [], asking: null })
})

test('AC7: each Band text row comes from its events', async (t) => {
  await t.test('claude working', () => {
    const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trust(109, 2, 12, 3 * MIN)])
    assert.equal(working(s, 16 * MIN), '▶ #12 verify · PR #109 · round 2 · 14m')
  })
  await t.test('interview waiting on the person', () => {
    const s = run([skill('next', 0), stage(108, 'grilling', 1, 'a decision is needed'), turnEnd(2)])
    assert.equal(idle(s, 5 * MIN), '◆ #108 grilling · answer the questions above')
  })
  await t.test('grilling skill with no stage', () => {
    const s = run([skill('next', 0), stage(108, 'implement', 1), skill('grilling', 2), turnEnd(3)])
    assert.equal(idle(s, 5 * MIN), '◆ #108 grilling · answer the questions above')
  })
  await t.test('PASS with an observed PR', () => {
    const s = run([skill('verify', 0), trust(109, 1, 12, 1), stage(12, 'merge', 2, 'the verdict for the current head is PASS'), turnEnd(3)])
    assert.equal(idle(s, MIN), '◆ #12 PASS · read verdict, merge PR #109')
  })
  await t.test('PASS with no observed PR', () => {
    const s = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2)])
    assert.equal(idle(s, MIN), '◆ #12 PASS · read verdict, merge the PR')
  })
  await t.test('stop, with each short reason', () => {
    const at = (why) => idle(run([skill('next', 0), stage(12, 'stop', 1, why), turnEnd(2)]), MIN)
    assert.equal(at('3 verdicts and the newest is NEEDS-FIX'), '◆ #12 stopped · NEEDS-FIX 3× · decide')
    assert.equal(at('more than one state label: ready, needsInfo'), '◆ #12 stopped · state labels conflict · decide')
    assert.equal(at('no rule fits: states=[] priority=true'), '◆ #12 stopped · no rule fits · decide')
    assert.equal(at('something new \u001b[31m'), '◆ #12 stopped · see /macro-loop:status · decide')
  })
  await t.test('a skill asked a question, the turn ended', () => {
    const s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), turnEnd(10 * MIN)])
    assert.equal(idle(s, 13 * MIN), '◆ #12 implement asks · see above · 3m')
  })
  await t.test('resumable', () => {
    const s = run([skill('next', 0), stage(93, 'resumable', 1), turnEnd(2)])
    assert.equal(idle(s, MIN), '◆ #93 new reply · run /macro-loop:next 93')
  })
  await t.test('wait', () => {
    const s = run([skill('next', 0), stage(101, 'wait', 1), turnEnd(5 * MIN)])
    assert.equal(idle(s, 125 * MIN), '◇ #101 waiting on requester · 2h')
    assert.equal(band(s, { isWorking: false, now: 0 }).tone, 'other')
  })
  await t.test('stage.mjs failed', () => {
    const s = run([skill('next', 0), failed(12, 1)])
    assert.equal(idle(s, MIN), '? #12 stage check failed · /macro-loop:status')
    assert.equal(working(s, MIN), '? #12 stage check failed · /macro-loop:status')
  })
  await t.test('done, then cleared at the next turn', () => {
    const s = run([skill('next', 0), stage(12, 'done', 1), turnEnd(2)])
    assert.equal(idle(s, MIN), '✓ #12 done')
    assert.equal(working(s, MIN), '✓ #12 done')
    assert.equal(band(s, { isWorking: false, now: MIN }).tone, 'done')
    assert.equal(render(reduce(s, turnStart(3)), { isWorking: true, now: MIN, columns: WIDE }), null)
  })
  await t.test('a skill with no Issue', () => {
    const s = run([skill('verify', 0)])
    assert.equal(working(s, 3 * MIN), '▶ verify · 3m')
  })
  await t.test('the waiting counter', () => {
    const s = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2), turnStart(3), skill('next', 4), stage(108, 'grilling', 5), turnEnd(6)])
    assert.equal(idle(s, MIN), '◆ #108 grilling · answer the questions above · +1 waiting (#12 merge)')
  })
  await t.test('tones follow the symbol', () => {
    const s = run([skill('next', 0), stage(12, 'merge', 1)])
    assert.equal(band(s, { isWorking: true, now: 0 }).tone, 'run')
    assert.equal(band(s, { isWorking: false, now: 0 }).tone, 'you')
    assert.equal(band(run([skill('next', 0), failed(12, 1)]), { isWorking: false, now: 0 }).tone, 'unknown')
  })
})

test('AC8: open-pr or verify after implement moves the ▶ band with no stage.mjs call', () => {
  let s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2)])
  assert.equal(working(s, 2 + 5 * MIN), '▶ #12 implement · 5m')
  s = reduce(s, skill('open-pr', 10 * MIN))
  assert.equal(working(s, 11 * MIN), '▶ #12 open-pr · 1m')
  s = reduce(s, { type: 'pr', pr: 109, at: 11 * MIN })
  s = reduce(s, skill('verify', 12 * MIN))
  assert.equal(working(s, 12 * MIN), '▶ #12 verify · PR #109 · 0m')
})

test('D8: a turn after a skill asked returns to ▶ while Claude works', () => {
  let s = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), turnEnd(MIN), turnStart(20 * MIN)])
  assert.equal(working(s, 21 * MIN), '▶ #12 implement · 20m')
  s = reduce(s, turnEnd(22 * MIN))
  assert.equal(idle(s, 25 * MIN), '◆ #12 implement asks · see above · 3m')
  const g = run([skill('next', 0), stage(108, 'implement', 1), skill('grilling', 2), turnEnd(MIN), turnStart(2 * MIN)])
  assert.equal(working(g, 3 * MIN), '▶ #108 grilling · 2m')
  // A stage-derived ◆ row stays.
  const m = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(MIN), turnStart(2 * MIN)])
  assert.equal(working(m, 3 * MIN), '◆ #12 PASS · read verdict, merge the PR')
})

test('D10: a skill after a ◆ merge band starts a new run and keeps the Issue in the counter', () => {
  const base = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2), turnStart(3)])
  for (const name of ['grilling', 'triage', 'spec']) {
    const s = reduce(base, skill(name, 4))
    assert.equal(s.cur.issue, null, name)
    assert.deepEqual(s.waiting.map((w) => w.issue), [12], name)
    assert.equal(working(s, 4 + MIN), `▶ ${name} · 1m · +1 waiting (#12 merge)`)
  }
  assert.equal(idle(run([skill('grilling', 4), turnEnd(5)], base), MIN), '◆ grilling · answer the questions above · +1 waiting (#12 merge)')
})

test('AC9: events with an agentId leave the state unchanged', () => {
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2)])
  const events = [
    skill('implement', 3),
    stage(13, 'merge', 3),
    failed(12, 3),
    trust(110, 3, 14, 3),
    { type: 'pr', pr: 111, at: 3 },
    { type: 'ask', id: 'toolu_1', at: 3 },
    { type: 'ran', id: 'toolu_1', at: 3 },
    turnEnd(3),
  ]
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
  assert.equal(idle(reduce(s, failed(null, 2)), MIN), '? #12 stage check failed · /macro-loop:status')
  assert.equal(idle(reduce(s, failed(12, 2)), MIN), '? #12 stage check failed · /macro-loop:status')
  assert.equal(idle(reduce(s, stage(12, 'bogus', 2)), MIN), '? #12 stage check failed · /macro-loop:status')
  // A good check afterwards recovers.
  assert.equal(idle(run([failed(12, 2), stage(12, 'merge', 3)], s), MIN), '◆ #12 PASS · read verdict, merge the PR')
})

test('AC11: a tool.check ask says approve the tool call until that call runs', () => {
  let s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2)])
  s = reduce(s, { type: 'ask', id: 'toolu_1', at: 3 })
  assert.equal(working(s, MIN), '◆ #12 verify · approve the tool call')
  assert.equal(band(s, { isWorking: true, now: MIN }).tone, 'you')
  assert.equal(reduce(s, { type: 'ran', id: 'toolu_2', at: 4 }), s)
  s = reduce(s, { type: 'ran', id: 'toolu_1', at: 4 })
  assert.equal(working(s, 2 + MIN), '▶ #12 verify · 1m')
  // An ask with no band is ignored.
  assert.equal(reduce(initial(), { type: 'ask', id: 'toolu_1', at: 1 }).asking, null)
})

test('AC12: a ◆ band survives unrelated turns and goes to the counter for another Issue', () => {
  let s = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2 * MIN)])
  assert.equal(idle(s, 5 * MIN), '◆ #12 PASS · read verdict, merge the PR')
  for (const ev of [turnStart(3 * MIN), turnEnd(4 * MIN), turnStart(5 * MIN), turnEnd(6 * MIN)]) {
    assert.equal(reduce(s, ev), s, ev.type)
    s = reduce(s, ev)
  }
  assert.equal(idle(s, 9 * MIN), '◆ #12 PASS · read verdict, merge the PR')
  // An implement asks row keeps its elapsed time across unrelated turns.
  let a = run([skill('next', 0), stage(7, 'implement', 1), turnEnd(MIN), turnStart(2 * MIN), turnEnd(3 * MIN)])
  assert.equal(idle(a, 5 * MIN), '◆ #7 implement asks · see above · 4m')
  // stage.mjs for another Issue in the same next run takes over.
  s = run([skill('next', 10 * MIN), stage(12, 'merge', 10 * MIN), stage(93, 'resumable', 11 * MIN)])
  assert.equal(idle(s, 12 * MIN), '◆ #93 new reply · run /macro-loop:next 93 · +1 waiting (#12 merge)')
  assert.equal(working(s, 12 * MIN), '▶ #93 next · 2m · +1 waiting (#12 merge)')
  // A third Issue: the counter names the newest.
  s = run([stage(108, 'grilling', 12 * MIN), turnEnd(13 * MIN)], s)
  assert.equal(idle(s, 14 * MIN), '◆ #108 grilling · answer the questions above · +2 waiting (#93 resumable)')
  // Back to a waiting Issue: it leaves the counter and the current one joins it.
  s = run([turnStart(15 * MIN), skill('next', 15 * MIN), stage(12, 'done', 16 * MIN)], s)
  assert.equal(idle(s, 16 * MIN), '✓ #12 done')
  assert.deepEqual(s.waiting.map((w) => w.issue), [93, 108])
  s = reduce(s, turnStart(17 * MIN))
  assert.equal(idle(s, 17 * MIN), '◆ #108 grilling · answer the questions above · +1 waiting (#93 resumable)')
  // A wait row is not counted.
  const w = run([skill('next', 0), stage(101, 'wait', 1), stage(12, 'merge', 2), turnEnd(3)])
  assert.equal(idle(w, MIN), '◆ #12 PASS · read verdict, merge the PR')
  // One entry per Issue.
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
  assert.equal(working(s, 5 + MIN), '▶ #12 verify · PR #109 · round 2 · 1m')
})

test('AC13: session end for clear or resume clears the band and counter', () => {
  const s = run([skill('next', 0), stage(12, 'merge', 1), stage(93, 'resumable', 2), { type: 'ask', id: 't', at: 3 }])
  for (const reason of ['clear', 'resume']) {
    const e = reduce(s, { type: 'sessionEnd', reason, at: 4 })
    assert.deepEqual(e, initial())
    assert.equal(render(e, { isWorking: false, now: 5, columns: WIDE }), null)
  }
  for (const reason of ['logout', 'prompt_input_exit', 'other', undefined]) assert.equal(reduce(s, { type: 'sessionEnd', reason, at: 4 }), s)
})

test('AC14: a narrow band drops parts in order and keeps the symbol and number', () => {
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trust(109, 2, 12, 3 * MIN)])
  const b = band(s, { isWorking: true, now: 16 * MIN })
  const seen = []
  for (let c = 60; c >= 0; c--) {
    const t = fit(b, c)
    if (seen.at(-1) !== t) seen.push(t)
    assert.ok([...t].length <= c || t === '▶ #12', `${c}: ${t}`)
    assert.ok(t.startsWith('▶ #12'))
  }
  assert.deepEqual(seen, ['▶ #12 verify · PR #109 · round 2 · 14m', '▶ #12 verify · PR #109 · round 2', '▶ #12 verify · PR #109', '▶ #12 verify', '▶ #12'])
  // The exact width keeps a part; one less drops it.
  assert.equal(fit(b, 38), '▶ #12 verify · PR #109 · round 2 · 14m')
  assert.equal(fit(b, 37), '▶ #12 verify · PR #109 · round 2')
  // A ◆ row drops the counter first, then elapsed, then the action, then the head.
  const p = run([skill('next', 0), stage(12, 'merge', 1), stage(7, 'implement', 2), turnEnd(3)])
  const pb = band(p, { isWorking: false, now: 3 + 3 * MIN })
  const order = []
  for (let c = 80; c >= 0; c--) if (order.at(-1) !== fit(pb, c)) order.push(fit(pb, c))
  assert.deepEqual(order, ['◆ #7 implement asks · see above · 3m · +1 waiting (#12 merge)', '◆ #7 implement asks · see above · 3m',
    '◆ #7 implement asks · see above', '◆ #7 implement asks', '◆ #7'])
  // No Issue: the head is never dropped.
  assert.equal(render(run([skill('verify', 0)]), { isWorking: true, now: MIN, columns: 1 }).text, '▶ verify')
  assert.doesNotThrow(() => fit(null, 10))
  assert.equal(fit(b, NaN), '▶ #12 verify · PR #109 · round 2 · 14m')
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
  assert.equal(working(s, MIN), '▶ verify · 1m')
  const sig = JSON.parse(signature(run([skill('next', 0), stage(12, 'merge', 1)]), 0))
  assert.deepEqual(sig, ['▶ #12 next · 0m', '◆ #12 PASS · read verdict, merge the PR'])
})

test('AC16: with no macro-loop activity nothing is drawn', () => {
  const quiet = run([turnStart(1), { type: 'ask', id: 't', at: 2 }, { type: 'ran', id: 't', at: 3 }, { type: 'pr', pr: 5, at: 4 },
    trust(5, 1, 3, 5), turnEnd(6), { type: 'skill', skill: 'other:verify', at: 7 }, { type: 'sessionEnd', reason: 'clear', at: 8 }])
  assert.deepEqual(quiet, initial())
  assert.equal(band(quiet, { isWorking: true, now: 9 }), null)
  assert.equal(render(quiet, { isWorking: false, now: 9, columns: WIDE }), null)
  assert.equal(signature(quiet, 9), '')
  assert.equal(render(null, { isWorking: false, now: 9, columns: WIDE }), null)
})

test('reduce never mutates its arguments and returns the same state when nothing changes', () => {
  const s = run([skill('next', 0), stage(12, 'merge', 1), stage(13, 'resumable', 2)])
  const copy = JSON.parse(JSON.stringify(s))
  const evs = [skill('verify', 3), stage(12, 'stop', 4), failed(null, 5), trust(1, 1, 14, 6), { type: 'ask', id: 'x', at: 7 }, turnEnd(8), turnStart(9),
    { type: 'sessionEnd', reason: 'clear', at: 10 }]
  for (const ev of evs) {
    const e = Object.freeze({ ...ev })
    reduce(s, e)
  }
  assert.deepEqual(s, copy)
  assert.equal(reduce(s, stage(13, 'resumable', 99)), s)
  assert.equal(reduce(initial(), { type: 'sessionEnd', reason: 'clear', at: 1 }).cur, null)
})

test('clean strips control and invisible characters from every part', () => {
  assert.equal(clean('a\u0000b\u001b[31mc\u007f\u0085\u200b\u200f\u2028\u202e\u2060\u2066\u2069\ufeffd'), 'ab[31mcd')
  assert.equal(clean(12), '12')
  assert.equal(clean({ toString() { throw new Error('x') } }), '')
  const b = { tone: 'you', parts: [{ text: '◆', rank: 0 }, { text: '#1', rank: 0 }, { text: 'x\u202ey', rank: 6 }] }
  assert.equal(fit(b, 50), '◆ #1 xy')
})

// D15: links to the GitHub objects the next action needs.
const REPO = { owner: 'o', repo: 'r' }
const GH = 'https://github.com/o/r'
const at = (s, o) => render(s, { columns: WIDE, now: 0, ...o, repo: REPO })
const labels = (s, o) => at(s, o).links.map((l) => l.label)
const line = (s, o) => fit(band(s, { now: 0, ...o, repo: REPO }), WIDE)
const SPEC = 6018031462
const VERDICT = 777

test('AC19: each stage D15 lists carries its links in order, built from the remote', async (t) => {
  await t.test('triage and grilling link the Issue', () => {
    const tr = run([skill('next', 0), stage(7, 'triage', 1), turnEnd(2)])
    assert.deepEqual(at(tr).links, [{ label: '#7', href: `${GH}/issues/7` }])
    const g = run([skill('next', 0), stage(108, 'grilling', 1), turnEnd(2)])
    assert.deepEqual(at(g).links, [{ label: '#108', href: `${GH}/issues/108` }])
    assert.equal(line(g), '◆ #108 grilling · answer the questions above · #108')
    // No Issue number, no Issue link.
    assert.deepEqual(at(run([skill('grilling', 0)]), { isWorking: true }).links, [])
  })
  await t.test('spec and implement link the spec comment', () => {
    const sp = run([skill('spec', 0), trustFull({ issue: 12, spec: SPEC }, 1)])
    assert.deepEqual(at(sp, { isWorking: true }).links, [{ label: 'spec', href: `${GH}/issues/12#issuecomment-${SPEC}` }])
    const im = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), trustFull({ issue: 12, spec: SPEC }, 3)])
    assert.deepEqual(labels(im, { isWorking: true }), ['spec'])
    assert.deepEqual(labels(reduce(im, turnEnd(4))), ['spec'])
  })
  await t.test('open-pr and verify link the PR, then the spec', () => {
    const base = [skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), trustFull({ issue: 12, spec: SPEC }, 3)]
    const op = run([...base, skill('open-pr', 4), { type: 'pr', pr: 109, at: 5 }])
    assert.deepEqual(at(op, { isWorking: true }).links, [
      { label: 'PR #109', href: `${GH}/pull/109` },
      { label: 'spec', href: `${GH}/issues/12#issuecomment-${SPEC}` },
    ])
    const v = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN),
      trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3 * MIN)])
    assert.deepEqual(labels(v, { isWorking: true }), ['PR #109', 'spec'])
    // The PR number moves out of the text into its link (D6 changed).
    assert.equal(at(v, { isWorking: true, now: 16 * MIN }).text, '▶ #12 verify · round 2 · 14m')
    assert.equal(line(v, { isWorking: true, now: 16 * MIN }), '▶ #12 verify · round 2 · 14m · PR #109 · spec')
  })
  await t.test('NEEDS-FIX links the verdict, then the PR', () => {
    const nf = trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3)
    const im = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2), nf])
    assert.deepEqual(at(im, { isWorking: true }).links, [
      { label: 'verdict', href: `${GH}/pull/109#issuecomment-${VERDICT}` },
      { label: 'PR #109', href: `${GH}/pull/109` },
    ])
    const st = run([skill('next', 0), nf, stage(12, 'stop', 4, '3 verdicts and the newest is NEEDS-FIX'), turnEnd(5)])
    assert.deepEqual(labels(st), ['verdict', 'PR #109'])
    assert.equal(line(st), '◆ #12 stopped · NEEDS-FIX 3× · decide · verdict · PR #109')
  })
  await t.test('PASS links the PR, then the verdict', () => {
    const s = run([skill('verify', 0), trustFull({ pr: 109, round: 1, issue: 12, spec: SPEC, verdict: VERDICT, verdictResult: 'PASS' }, 1),
      stage(12, 'merge', 2, 'the verdict for the current head is PASS'), turnEnd(3)])
    assert.deepEqual(at(s).links, [
      { label: 'PR #109', href: `${GH}/pull/109` },
      { label: 'verdict', href: `${GH}/pull/109#issuecomment-${VERDICT}` },
    ])
    assert.equal(line(s), '◆ #12 PASS · read verdict, merge the PR · PR #109 · verdict')
  })
  await t.test('rows D15 does not list carry none', () => {
    for (const [st, why] of [['resumable', ''], ['wait', ''], ['stop', 'no rule fits']]) {
      const s = run([skill('next', 0), trustFull({ issue: 12, spec: SPEC, pr: 109 }, 1), stage(12, st, 2, why), turnEnd(3)])
      assert.deepEqual(at(s).links, [], st)
    }
    assert.deepEqual(at(run([skill('next', 0), failed(12, 1)])).links, [])
    assert.deepEqual(at(run([skill('next', 0), stage(12, 'done', 1)])).links, [])
  })
})

test('AC20: an id not observed leaves its link out and the others stay', () => {
  // verify with no spec seen: the PR alone.
  const v = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ pr: 109, round: 1 }, 3)])
  assert.deepEqual(labels(v, { isWorking: true }), ['PR #109'])
  // PASS with no verdict id: the PR alone; with no PR either, no links and the plain wording.
  const p = run([skill('next', 0), trustFull({ pr: 109, issue: 12, spec: null, verdict: null, verdictResult: 'PASS' }, 1), stage(12, 'merge', 2), turnEnd(3)])
  assert.deepEqual(labels(p), ['PR #109'])
  const bare = run([skill('next', 0), stage(12, 'merge', 1), turnEnd(2)])
  assert.deepEqual(at(bare).links, [])
  assert.equal(at(bare).text, '◆ #12 PASS · read verdict, merge the PR')
  // implement with no spec seen has none; a spec link needs the Issue number.
  assert.deepEqual(labels(run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2)]), { isWorking: true }), [])
  assert.deepEqual(labels(run([skill('spec', 0)]), { isWorking: true }), [])
  // trust.mjs --pr with no Issue keeps the spec seen before; a spec of null clears it.
  const kept = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ issue: 12, spec: SPEC }, 3), trustFull({ pr: 109 }, 4)])
  assert.deepEqual(labels(kept, { isWorking: true }), ['PR #109', 'spec'])
  assert.deepEqual(labels(reduce(kept, trustFull({ issue: 12, spec: null }, 5)), { isWorking: true }), ['PR #109'])
  // A new PR drops the old PR's verdict.
  const nf = run([skill('next', 0), trustFull({ pr: 109, issue: 12, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 1), stage(12, 'stop', 2, '3 verdicts'), turnEnd(3)])
  assert.deepEqual(labels(nf), ['verdict', 'PR #109'])
  const moved = run([skill('next', 0), stage(12, 'implement', 1), skill('implement', 2),
    trustFull({ pr: 109, issue: 12, verdict: VERDICT, verdictResult: 'NEEDS-FIX' }, 3), { type: 'pr', pr: 110, at: 4 }])
  assert.equal(moved.cur.pr, 110)
  assert.deepEqual(labels(moved, { isWorking: true }), [])
  // Garbage ids are not observed.
  const g = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2), trustFull({ pr: 109, issue: 12, spec: -1, verdict: 1.5, verdictResult: 'MAYBE' }, 3)])
  assert.deepEqual(labels(g, { isWorking: true }), ['PR #109'])
  assert.equal(g.cur.verdictResult, null)
  for (const ev of [trustFull({ pr: NaN, issue: 12 }), trustFull({ pr: 109, issue: '12' }), trustFull({})])
    assert.equal(reduce(g, ev), g, JSON.stringify(ev))
})

test('AC21: owner and repo come from https, git@ and ssh:// remotes; any other gives no links', () => {
  for (const url of ['https://github.com/o/r.git', 'https://github.com/o/r', 'https://github.com/o/r/', 'git@github.com:o/r.git',
    'git@github.com:o/r', 'ssh://git@github.com/o/r', 'ssh://git@github.com/o/r.git', 'ssh://git@github.com:22/o/r',
    'https://token@github.com/o/r.git', ' https://github.com/o/r.git\r\n'])
    assert.deepEqual(repoOf(url), REPO, url)
  assert.deepEqual(repoOf('https://github.com/juhyeonni/cc-plugins.git'), { owner: 'juhyeonni', repo: 'cc-plugins' })
  for (const url of ['https://gitlab.com/o/r.git', 'http://github.com/o/r', 'git@gitlab.com:o/r.git', 'https://github.com/o',
    'https://github.com/o/r/x', 'https://github.com.evil.io/o/r', 'file:///c/repo', 'C:\\repo', '../r', '', 'https://github.com/o/..',
    'https://github.com/o/r\u001b]8;;x', 'https://github.com/o/r?x=1', null, undefined, 42, {}])
    assert.equal(repoOf(url), null, String(url))
  // No GitHub remote: no links, and exactly the text the band shows without links.
  const s = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN), trust(109, 2, 12, 3 * MIN),
    trustFull({ issue: 12, spec: SPEC }, 3 * MIN)])
  const o = { isWorking: true, now: 16 * MIN, columns: WIDE }
  for (const repo of [null, repoOf('https://gitlab.com/o/r.git'), undefined, 'o/r', { owner: 'o' }]) {
    assert.deepEqual(render(s, { ...o, repo }), { text: '▶ #12 verify · PR #109 · round 2 · 14m', links: [], tone: 'run' }, String(repo))
    assert.equal(signature(s, 16 * MIN, repo), signature(s, 16 * MIN))
  }
  // With a remote the signature changes, so the glue redraws once the remote is read.
  assert.notEqual(signature(s, 16 * MIN, REPO), signature(s, 16 * MIN))
})

test('AC22: as the width shrinks, links drop from the right before the action, and #<n> stays', () => {
  const steps = (s, o, from) => {
    const b = band(s, { now: 0, ...o, repo: REPO })
    const seen = []
    for (let c = from; c >= 0; c--) {
      const t = fit(b, c)
      if (seen.at(-1) !== t) seen.push(t)
    }
    return seen
  }
  const v = run([skill('next', 0), stage(12, 'verify', 1), skill('verify', 2 * MIN),
    trustFull({ pr: 109, round: 2, issue: 12, spec: SPEC }, 3 * MIN)])
  assert.deepEqual(steps(v, { isWorking: true, now: 16 * MIN }, 80), ['▶ #12 verify · round 2 · 14m · PR #109 · spec',
    '▶ #12 verify · round 2 · PR #109 · spec', '▶ #12 verify · PR #109 · spec', '▶ #12 verify · PR #109', '▶ #12 verify', '▶ #12'])
  const p = run([skill('verify', 0), trustFull({ pr: 109, issue: 12, verdict: VERDICT, verdictResult: 'PASS' }, 1), stage(12, 'merge', 2), turnEnd(3)])
  assert.deepEqual(steps(p, {}, 80), ['◆ #12 PASS · read verdict, merge the PR · PR #109 · verdict',
    '◆ #12 PASS · read verdict, merge the PR · PR #109', '◆ #12 PASS · read verdict, merge the PR', '◆ #12 PASS', '◆ #12'])
  // The kept links are the ones drawn.
  assert.deepEqual(render(p, { now: 0, columns: 49, repo: REPO }).links.map((l) => l.label), ['PR #109'])
  assert.equal(render(p, { now: 0, columns: 49, repo: REPO }).text, '◆ #12 PASS · read verdict, merge the PR')
  // The Issue link of triage and grilling is never dropped.
  const g = run([skill('next', 0), stage(108, 'grilling', 1), stage(12, 'merge', 2), stage(108, 'grilling', 3), turnEnd(4)])
  assert.deepEqual(steps(g, {}, 90), ['◆ #108 grilling · answer the questions above · +1 waiting (#12 merge) · #108',
    '◆ #108 grilling · answer the questions above · #108', '◆ #108 grilling · #108', '◆ #108 · #108'])
  for (let c = 0; c <= 90; c++) assert.deepEqual(render(g, { now: 0, columns: c, repo: REPO }).links.map((l) => l.label), ['#108'], String(c))
})

test('D15: the PR link rewrites only the PASS row, not an ask or a running next at merge', () => {
  const m = run([skill('next', 0), trustFull({ pr: 109, issue: 12, spec: 5, verdict: 7, verdictResult: 'PASS' }, 1), stage(12, 'merge', 2)])
  assert.equal(at(reduce(m, { type: 'ask', id: 't1', at: 3 })).text, '◆ #12 next · approve the tool call')
  assert.equal(at(m, { isWorking: true }).text, '▶ #12 next · 0m')
})
