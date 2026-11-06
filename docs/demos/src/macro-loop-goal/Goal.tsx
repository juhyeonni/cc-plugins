import { Check, Collapse, Stage, Window, type Act } from '../../kit'
import { Octicon } from '../gh-readme/octicons'
import '../macro-loop-tour/tour.css'
import './goal.css'

// A goal run with nobody watching (HOOTL, ADR-0019): one question round about
// the goal, the children run, the one-way door waits in the question queue, and
// the run stops at the merge.

const PHASES = ['goal', 'split', 'specs', 'ask once', 'run', 'summary', 'merge']

const CHILDREN = [
  [21, 'Export a chart\'s data as CSV, with the active filters'],
  [22, 'Download a chart as PNG'],
  [23, 'Weekly email digest of the dashboard'],
  [24, 'Read-only share link without login'],
  [25, 'Docs: how to share a dashboard'],
] as const
const HELD = 3

// Each child's band cell: 0 triage, 1 grilling/spec, 2 implement, 3 open-pr, 4 verify, 5 merge (a person)
const STEPS: number[][] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 1, 2],
  [3, 3, 3, 1, 3],
  [4, 4, 4, 1, 4],
  [5, 5, 2, 1, 5],
  [5, 5, 4, 1, 5],
  [5, 5, 5, 1, 5],
]
const NAMES = ['triage', 'spec', 'implement', 'open-pr', 'verify', 'merge']

type Line = [kind: 'you' | 'out' | 'dim', text: string]
const LINES: Line[] = [
  ['you', '/macro-loop:goal Let people share what they see on the dashboard: download it, get it by email every week, and send a link to someone without an account.'],
  ['out', 'Q1. Who gets the weekly email?'],
  ['dim', 'Recommended: the people the owner adds'],
  ['you', 'yes'],
  ['out', 'goal #20: 5 Issues, 5 specs pinned'],
  ['out', '#24 held: needs-decision (a link without login)'],
  ['out', 'Ask once: #24, spec commands, push'],
  ['you', 'push yes, spec commands none'],
  ['out', 'execute: 4 Issues in parallel'],
  ['out', '#23 NEEDS-FIX r1 (time zone) → answer → r2'],
  ['out', '4 PRs PASS · #24 waits for you · summary on #20'],
]

type S = { step: number; phase: number; lines: number; r2: boolean; page: 'track' | 'sum' }
const initial: S = { step: 0, phase: 0, lines: 1, r2: false, page: 'track' }
const POSTER: S = { step: 7, phase: 6, lines: LINES.length, r2: true, page: 'sum' }

async function script(a: Act<S>) {
  await a.wait(900)
  await a.set({ lines: 2 })
  await a.wait(500)
  await a.set({ lines: 3 })
  await a.wait(900)
  await a.set({ lines: 4 })
  await a.wait(500)
  await a.set({ lines: 5, phase: 1, step: 1 })
  await a.wait(1000)
  await a.set({ lines: 6, phase: 2, step: 2 })
  await a.wait(1100)
  await a.set({ lines: 7, phase: 3 })
  await a.wait(900)
  await a.set({ lines: 8 })
  await a.wait(600)
  await a.set({ lines: 9, phase: 4, step: 3 })
  for (let s = 4; s < STEPS.length; s++) {
    await a.wait(1100)
    await a.set({ step: s, ...(s === 5 ? { lines: 10, r2: true } : {}) })
  }
  await a.wait(900)
  await a.set({ lines: 11, phase: 5 })
  await a.wait(800)
  await a.set({ phase: 6, page: 'sum' })
  await a.wait(3600)
  await a.set({ page: 'track' })
  await a.wait(220)
  await a.snap({ ...initial })
  await a.wait(600)
}

export function Goal() {
  return (
    <Stage width={1040} height={620} compact={{ below: 760, width: 358, height: 600 }} initial={initial} poster={POSTER} script={script} className="mlt mlg">
      {(s, _rect, layout) => {
        const cells = STEPS[s.step]
        const ready = cells.filter((c, i) => c === 5 && i !== HELD).length
        return (
          <>
            <Phases phase={s.phase} />

            <Window url={`${layout === 'wide' ? 'github.com/acme/metrics-dashboard' : 'github.com/…/metrics-dashboard'}/issues/20`} nav className="mlt-browser">
              <div className="mlt-pages" data-page={s.page}>
                <Tracking cells={cells} held={s.step >= 2} />
                <Summary />
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
                  <BandRow sym={ready === 4 ? '◆' : '▶'} n={20} cell={Math.floor((ready / 5) * 6)} stage={`goal ${ready}/5`} goal />
                  {CHILDREN.map(([n], i) => {
                    const held = i === HELD && s.step >= 2
                    return (
                      <BandRow
                        key={n}
                        hideCompact={i === 1 || i === 4}
                        sym={held || cells[i] === 5 ? '◆' : '▶'}
                        n={n}
                        cell={cells[i]}
                        stage={held ? 'held' : NAMES[cells[i]]}
                        round={n === 23 && s.r2 && cells[i] < 5 ? 'r2' : ''}
                      />
                    )
                  })}
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

function Phases({ phase }: { phase: number }) {
  return (
    <div className="mlt-rail">
      {PHASES.map((name, i) => (
        <div key={name} className="mlt-step" data-state={i < phase ? 'done' : i === phase ? 'active' : 'todo'} data-you={name === 'merge' || undefined}>
          {i > 0 && <span className="mlt-wire" data-lit={i <= phase || undefined} />}
          <span className="mlt-node">
            <Check on={i < phase} pending={i === phase && name !== 'merge'} size={14} />
            <span className="mlt-name">{name}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function BandRow({ sym, n, cell, stage, round = '', goal, hideCompact }: { sym: string; n: number; cell: number; stage: string; round?: string; goal?: boolean; hideCompact?: boolean }) {
  return (
    <div className="mlg-row" data-wide-only={hideCompact || undefined} data-done={(sym === '◆' && !goal) || undefined} data-goal={goal || undefined}>
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

function Head({ title }: { title: string }) {
  return (
    <>
      <div className="gh-title">
        {title} <span className="gh-num">#20</span>
      </div>
      <span className="gh-state" data-tone="open">
        <Octicon name="issue" size={14} />
        Open
      </span>
    </>
  )
}

function Tracking({ cells, held }: { cells: number[]; held: boolean }) {
  return (
    <div className="gh-pg" data-name="track">
      <Head title="Share the dashboard" />
      <div className="gh-box mlg-body">
        <div className="mlg-h">Goal</div>
        <div>Let people share what they see on the dashboard: download it, get it by email every week, and send a link to someone without an account.</div>
        <div className="mlg-h mlg-decided">Done state</div>
        <div className="mlg-decided">Each way of sharing works and has docs.</div>
        <div className="mlg-h mlg-decided">Decisions so far</div>
        <ul className="mlg-decided">
          <li>The weekly email goes to the people the owner adds.</li>
          <li>Out of scope: scheduled exports to other tools.</li>
        </ul>
        <div className="mlg-h">Tasks</div>
        <div className="mlg-tasks">
          {CHILDREN.map(([n, title], i) => {
            const done = cells[i] === 5 && i !== HELD
            return (
              <div key={n} className="mlg-task" data-done={done || undefined}>
                <span className="gh-box-check mlg-check" />
                <span className="mlg-task-icon">
                  <Octicon name={done ? 'checkCircle' : 'issue'} size={14} />
                </span>
                <span className="mlg-task-title">{title}</span>
                {i === HELD && held && <span className="gh-label" data-l="p1">needs-decision</span>}
                <span className="gh-num">#{n}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Summary() {
  return (
    <div className="gh-pg" data-name="sum">
      <Head title="Share the dashboard" />
      <div className="gh-box mlg-body">
        <div className="mlg-h">Question for you</div>
        <div><b>Child:</b> #24 · <b>Type:</b> approval</div>
        <div><b>Question:</b> May anyone with the link see the dashboard without an account?</div>
        <div><b>Recommended:</b> yes, read only, link expires in 7 days</div>
        <div><b>Blocks:</b> #24 only</div>
        <div className="mlg-h">Summary</div>
        <ul>
          <li>#21 PR #26, #22 PR #27, #25 PR #29: PASS</li>
          <li>#23 PR #28: PASS in round 2, after the digest was fixed to use the recipient's time zone</li>
          <li>#24 is held until you answer</li>
        </ul>
        <div className="mlg-h">What you do</div>
        <div>Answer #24's question, then read and merge the four PRs.</div>
      </div>
    </div>
  )
}
