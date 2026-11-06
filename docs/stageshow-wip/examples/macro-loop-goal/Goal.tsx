import { Bar, Check, Collapse, Stage, Window, type Act } from '../../kit'
import { Octicon } from '../gh-readme/octicons'
import '../macro-loop-tour/tour.css'
import './goal.css'

// A goal run with nobody watching (HOOTL). Placeholder content: replace with the dashboard goal (see the tracking Issue).
// Claude Code's /goal keeps calling /macro-loop:goal; each round carries its
// child Issues to merged PRs, then a review opens the next round's goal.

const ROUNDS = [
  ['v1', 13],
  ['v2', 29],
  ['v3', 45],
  ['v4', 56],
  ['v5', 65],
  ['v6', 78],
] as const

const V2 = [
  [21, 'Export a chart\'s data as CSV, with the active filters'],
  [22, 'Download a chart as PNG'],
  [23, 'Weekly email digest of the dashboard'],
  [24, 'Read-only share link without login'],
  [25, 'Placeholder child 5'],
  [26, 'Placeholder child 6'],
  [27, 'Placeholder child 7'],
  [28, 'Docs: how to share a dashboard'],
] as const
const V3 = [38, 41, 39, 40, 42, 43, 44]

// Each child's band cell: 0 triage, 1 grilling/spec, 2 implement, 3 open-pr, 4 verify, 5 merge, 6 done
const STEPS: number[][] = [
  [2, 2, 2, 2, 2, 2, 2, 2],
  [3, 3, 2, 3, 2, 3, 2, 2],
  [4, 4, 3, 4, 3, 4, 3, 2],
  [6, 5, 4, 5, 4, 4, 4, 3],
  [6, 6, 2, 6, 5, 2, 5, 4],
  [6, 6, 3, 6, 6, 4, 6, 5],
  [6, 6, 4, 6, 6, 6, 6, 6],
  [6, 6, 6, 6, 6, 6, 6, 6],
]
const NAMES = ['triage', 'spec', 'implement', 'open-pr', 'verify', 'merge', 'done']

type Line = [kind: 'you' | 'out' | 'dim', text: string]
const LINES: Line[] = [
  ['you', '/macro-loop:goal Let people share what they see on the dashboard: download it, get it by email every week, and send a link to someone without an account.'],
  ['out', 'macro-loop:goal  #29 v2: 8 Issues, 8 specs pinned'],
  ['dim', 'Decisions settled by research; none held for you'],
  ['out', 'macro-loop:execute  8 Issues in parallel'],
  ['out', '#23 NEEDS-FIX r1 → answer → implement r2'],
  ['out', 'Round v2: 8 PRs PASS and merged · #29 closed'],
  ['out', 'Review: gaps left after v2 → goal #45 v3, 7 Issues'],
]

type S = { step: number; round: number; lines: number; r2: boolean; page: 'v2' | 'v3' }
const initial: S = { step: 0, round: 1, lines: 2, r2: false, page: 'v2' }
const POSTER: S = { step: 7, round: 2, lines: LINES.length, r2: true, page: 'v3' }

async function script(a: Act<S>) {
  await a.wait(900)
  await a.set({ lines: 3 })
  await a.wait(600)
  await a.set({ lines: 4, step: 1 })
  for (let s = 2; s < STEPS.length; s++) {
    await a.wait(1100)
    await a.set({ step: s, ...(s === 4 ? { lines: 5, r2: true } : {}) })
  }
  await a.wait(1100)
  await a.set({ lines: 6, round: 1.5 })
  await a.wait(1300)
  await a.set({ lines: 7, round: 2, page: 'v3' })
  await a.wait(3600)
  // The next loop shows the same round again: cut while the page swaps back
  await a.set({ page: 'v2' })
  await a.wait(220)
  await a.snap({ ...initial })
  await a.wait(600)
}

export function Goal() {
  return (
    <Stage width={1040} height={620} compact={{ below: 760, width: 358, height: 600 }} initial={initial} poster={POSTER} script={script} className="mlt mlg">
      {(s, _rect, layout) => {
        const cells = STEPS[s.step]
        const done = cells.filter((c) => c === 6).length
        return (
          <>
            <Rounds round={s.round} />

            <Window url={`${layout === 'wide' ? 'github.com/acme/metrics-dashboard' : 'github.com/…/metrics-dashboard'}/issues/${s.page === 'v2' ? 29 : 45}`} nav className="mlt-browser">
              <div className="mlt-pages" data-page={s.page}>
                <TrackingV2 cells={cells} />
                <TrackingV3 />
              </div>
            </Window>

            <Window className="mlt-term">
              <div className="mlt-term-body">
                <div className="mlt-history">
                  {LINES.map(([kind, text], i) => (
                    <Collapse key={i} open={i < s.lines}>
                      <div className="mlt-line" data-kind={kind === 'you' ? 'cmd' : kind}>
                        {kind === 'you' ? `> ${text}` : kind === 'out' ? `⏺ ${text}` : `  ⎿  ${text}`}
                      </div>
                    </Collapse>
                  ))}
                </div>

                <div className="mlg-band">
                  <BandRow sym={s.round >= 1.5 ? '✓' : '▶'} n={29} cell={Math.floor((done / 8) * 6)} stage={`goal ${done}/8`} goal />
                  {V2.slice(0, 4).map(([n], i) => (
                    <BandRow key={n} hideCompact={i === 1 || i === 3} sym={cells[i] === 6 ? '✓' : '▶'} n={n} cell={cells[i]} stage={NAMES[cells[i]]} round={n === 23 && s.r2 && cells[i] < 6 ? 'r2' : ''} />
                  ))}
                  <div className="mlg-more">
                    <span className="mlg-more-wide">+4 more</span>
                    <span className="mlg-more-compact">+6 more</span> · /macro-loop:status
                  </div>
                </div>

                <div className="mlt-input" data-snap>
                  <span className="mlt-sigil">&gt;</span>
                  <span className="mlt-caret">█</span>
                </div>
              </div>
            </Window>
          </>
        )
      }}
    </Stage>
  )
}

function Rounds({ round }: { round: number }) {
  const stateOf = (i: number) => (i === 0 || (i === 1 && round >= 1.5) ? 'done' : (i === 1 && round < 1.5) || (i === 2 && round === 2) ? 'active' : 'todo')
  return (
    <div className="mlt-rail">
      {ROUNDS.map(([v, n], i) => (
        <div key={v} className="mlt-step" data-state={stateOf(i)}>
          {i > 0 && <span className="mlt-wire" data-lit={stateOf(i) !== 'todo' || undefined} />}
          <span className="mlt-node">
            <Check on={stateOf(i) === 'done'} pending={stateOf(i) === 'active'} size={14} />
            <span className="mlt-name">
              {v} <span className="mlg-num">#{n}</span>
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

function BandRow({ sym, n, cell, stage, round = '', goal, hideCompact }: { sym: string; n: number; cell: number; stage: string; round?: string; goal?: boolean; hideCompact?: boolean }) {
  return (
    <div className="mlg-row" data-wide-only={hideCompact || undefined} data-done={sym === '✓' || undefined} data-goal={goal || undefined}>
      <span className="mlt-band-sym">{sym}</span>
      <span className="mlt-band-issue">#{n}</span>
      <span className="mlt-band-track" data-snap>
        {[0, 1, 2, 3, 4, 5].map((c) => (
          <span key={c} data-cell={c < cell ? 'passed' : c === cell ? 'here' : 'ahead'}>
            {c < cell ? '●' : c === cell ? '◐' : '○'}
          </span>
        ))}
      </span>
      <span className="mlg-stage" data-snap>{stage}</span>
      <span className="mlg-r">{round}</span>
    </div>
  )
}

function Head({ n, title, closed }: { n: number; title: string; closed?: boolean }) {
  return (
    <>
      <div className="gh-title">
        {title} <span className="gh-num">#{n}</span>
      </div>
      <span className="gh-state" data-tone={closed ? 'closed' : 'open'}>
        <Octicon name={closed ? 'checkCircle' : 'issue'} size={14} />
        {closed ? 'Closed' : 'Open'}
      </span>
    </>
  )
}

function TrackingV2({ cells }: { cells: number[] }) {
  const all = cells.every((c) => c === 6)
  return (
    <div className="gh-pg" data-name="v2">
      <Head n={29} title="Share the dashboard (placeholder)" closed={all} />
      <div className="gh-box mlg-body">
        <div className="mlg-h">Goal</div>
        <div>Placeholder goal text.</div>
        <div className="mlg-h mlg-decided">Decisions so far</div>
        <ul className="mlg-decided">
          <li>Placeholder decision</li>
          <li>Placeholder decision</li>
        </ul>
        <div className="mlg-h">Tasks</div>
        <div className="mlg-tasks">
          {V2.map(([n, title], i) => (
            <div key={n} className="mlg-task" data-done={cells[i] === 6 || undefined}>
              <span className="gh-box-check mlg-check" />
              <span className="mlg-task-icon">
                <Octicon name={cells[i] === 6 ? 'checkCircle' : 'issue'} size={14} />
              </span>
              <span className="mlg-task-title">{title}</span>
              <span className="gh-num">#{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TrackingV3() {
  return (
    <div className="gh-pg" data-name="v3">
      <Head n={45} title="Next round (placeholder)" />
      <div className="gh-box mlg-body">
        <div className="mlg-h">Goal</div>
        <div>Placeholder goal text for the next round.</div>
        <div className="mlg-h mlg-decided">Decisions so far</div>
        <ul className="mlg-decided">
          <li>Placeholder decision</li>
          <li>Placeholder decision</li>
        </ul>
        <div className="mlg-h">Tasks</div>
        <div className="mlg-tasks">
          {V3.map((n, i) => (
            <div key={n} className="mlg-task">
              <span className="gh-box-check mlg-check" />
              <span className="mlg-task-icon">
                <Octicon name="issue" size={14} />
              </span>
              <Bar w={[210, 170, 240, 190, 150, 220, 180][i]} h={7} tone={2} />
              <span className="gh-num">#{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
