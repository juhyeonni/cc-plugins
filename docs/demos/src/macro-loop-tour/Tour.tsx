import { Avatar, Button, Check, Collapse, Roll, Stage, Window, type Act } from '../../kit'
import { Octicon } from '../gh-readme/octicons'
import './tour.css'

// macro-loop end to end: the stages across the top, the commands typed in
// Claude Code, and what each one leaves on the GitHub Issue, ending on the
// PR's PASS verdict.

const STAGES = ['triage', 'grilling', 'spec', 'implement', 'open-pr', 'verify', 'merge']

type Kind = 'cmd' | 'out' | 'dim' | 'you'
const LINES: [Kind, string][] = [
  ['cmd', '/macro-loop:triage #21'],
  ['out', '#21: P1 · ready-for-agent · source:requester'],
  ['cmd', '/macro-loop:grilling #21'],
  ['out', 'Q1. Which rows does the file hold?'],
  ['dim', 'Recommended: the rows the chart shows now'],
  ['you', 'yes'],
  ['cmd', '/macro-loop:spec #21'],
  ['out', 'Spec pinned on #21 with 3 criteria'],
  ['cmd', '/macro-loop:implement #21'],
  ['out', '3 commits on 21-export-csv'],
  ['out', 'open-pr: draft PR #26, Closes #21'],
  ['out', 'verify: PASS (round 1 of 3)'],
]

// The band's six cells: triage, grilling (with spec), implement, open-pr, verify, merge
type Band = { on: boolean; you: boolean; cell: number; stage: string; todo: string }

type S = {
  active: number
  done: number
  lines: number
  input: string
  band: Band
  labels: boolean
  spec: boolean
  pr: boolean
  page: 'issue' | 'pr'
  prBody: boolean
}

const OFF: Band = { on: false, you: false, cell: 0, stage: 'triage', todo: '' }
const initial: S = { active: -1, done: 0, lines: 0, input: '', band: OFF, labels: false, spec: false, pr: false, page: 'issue', prBody: false }
const POSTER: S = { active: 6, done: 6, lines: LINES.length, input: '', band: { on: true, you: true, cell: 5, stage: 'merge', todo: 'merge the PR' }, labels: true, spec: true, pr: true, page: 'pr', prBody: false }

async function run(a: Act<S>, command: string, upTo: number) {
  await a.type('input', command, { interval: 28 })
  await a.wait(200)
  await a.key('enter')
  await a.set({ input: '', lines: upTo })
}

async function script(a: Act<S>) {
  await a.wait(800)

  // triage: labels on the Issue
  await run(a, LINES[0][1], 1)
  await a.set({ active: 0, band: { on: true, you: false, cell: 0, stage: 'triage', todo: '' } })
  await a.wait(900)
  await a.set({ lines: 2, labels: true })
  await a.wait(500)
  await a.set({ done: 1 })
  await a.wait(500)

  // grilling: a question with a recommended answer, answered
  await run(a, LINES[2][1], 3)
  await a.set({ active: 1, band: { on: true, you: false, cell: 1, stage: 'grilling', todo: '' } })
  await a.wait(700)
  await a.set({ lines: 5, band: { on: true, you: true, cell: 1, stage: 'grilling', todo: 'answer Qs' } })
  await a.wait(1000)
  await run(a, 'yes', 6)
  await a.set({ done: 2, band: { on: true, you: false, cell: 1, stage: 'grilling', todo: '' } })
  await a.wait(500)

  // spec: the pinned comment verify judges against
  await run(a, LINES[6][1], 7)
  await a.set({ active: 2, band: { on: true, you: false, cell: 1, stage: 'spec', todo: '' } })
  await a.wait(900)
  await a.set({ lines: 8, spec: true })
  await a.wait(600)
  await a.set({ done: 3 })
  await a.wait(500)

  // implement hands over to open-pr and verify on its own
  await run(a, LINES[8][1], 9)
  await a.set({ active: 3, band: { on: true, you: false, cell: 2, stage: 'implement', todo: '' } })
  await a.wait(1100)
  await a.set({ lines: 10, done: 4, active: 4, band: { on: true, you: false, cell: 3, stage: 'open-pr', todo: '' } })
  await a.wait(900)
  await a.set({ lines: 11, pr: true, done: 5, active: 5, band: { on: true, you: false, cell: 4, stage: 'verify', todo: '' } })
  await a.wait(1400)
  await a.set({ lines: 12, done: 6, active: 6, band: { on: true, you: true, cell: 5, stage: 'merge', todo: 'merge the PR' } })
  await a.wait(500)

  // The result: the PR with its verdict
  await a.set({ page: 'pr', prBody: true })
  await a.wait(2800)
  await a.set({ prBody: false })
  await a.wait(3400)

  // /clear and back to the Issue for the next run
  await a.type('input', '/clear', { interval: 40 })
  await a.key('enter')
  await a.set({ ...initial })
  await a.wait(900)
}

export function Tour() {
  return (
    <Stage width={960} height={580} compact={{ below: 720, width: 358, height: 560 }} initial={initial} poster={POSTER} script={script} keys="bottom-left" className="mlt">
      {(s) => (
        <>
          <Rail active={s.active} done={s.done} />

          <Window url={s.page === 'issue' ? 'github.com/acme/metrics-dashboard/issues/21' : 'github.com/acme/metrics-dashboard/pull/26'} nav className="mlt-browser">
            <div className="mlt-pages" data-page={s.page}>
              <IssuePage s={s} />
              <PrPage body={s.prBody} />
            </div>
          </Window>

          <Window title="~/metrics-dashboard — claude" className="mlt-term">
            <div className="mlt-term-body">
              <div className="mlt-history">
                <Welcome />
                {LINES.map(([kind, text], i) => (
                  <Collapse key={i} open={i < s.lines}>
                    <div className="mlt-line" data-kind={kind}>
                      {kind === 'cmd' || kind === 'you' ? `> ${text}` : kind === 'out' ? `⎿  ${text}` : `   ${text}`}
                    </div>
                  </Collapse>
                ))}
              </div>
              <BandRow band={s.band} />
              <div className="mlt-input" data-snap>
                <span className="mlt-sigil">&gt;</span>
                <span>
                  {s.input}
                  <span className="mlt-caret">█</span>
                </span>
              </div>
            </div>
          </Window>
        </>
      )}
    </Stage>
  )
}

function Rail({ active, done }: { active: number; done: number }) {
  return (
    <div className="mlt-rail">
      {STAGES.map((name, i) => (
        <div key={name} className="mlt-step" data-state={i < done ? 'done' : i === active ? 'active' : 'todo'} data-you={name === 'merge' || undefined}>
          {i > 0 && <span className="mlt-wire" data-lit={i <= done || undefined} />}
          <span className="mlt-node">
            <Check on={i < done} pending={i === active && i >= done && name !== 'merge'} size={14} />
            <span className="mlt-name">{name}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// macro-loop-band's row: symbol, Issue, six-cell track, stage, what you do
function BandRow({ band }: { band: Band }) {
  return (
    <div className="mlt-band" data-on={band.on || undefined} data-you={band.you || undefined}>
      <span className="mlt-band-sym" data-snap>{band.you ? '◆' : '▶'}</span>
      <span className="mlt-band-issue">#21</span>
      <span className="mlt-band-track" data-snap>
        {[0, 1, 2, 3, 4, 5].map((c) => (
          <span key={c} data-cell={c < band.cell ? 'passed' : c === band.cell ? 'here' : 'ahead'}>
            {c < band.cell ? '●' : c === band.cell ? '◐' : '○'}
          </span>
        ))}
      </span>
      <span className="mlt-band-stage">
        <Roll>{band.stage}</Roll>
      </span>
      <span className="mlt-band-todo">
        <Roll>{band.todo || ' '}</Roll>
      </span>
    </div>
  )
}

function Event({ icon, children }: { icon: 'tag' | 'pr'; children: React.ReactNode }) {
  return (
    <div className="gh-event">
      <span className="gh-event-icon">
        <Octicon name={icon} size={14} />
      </span>
      <div className="gh-event-text">{children}</div>
    </div>
  )
}

function IssuePage({ s }: { s: S }) {
  return (
    <div className="gh-pg" data-name="issue">
      <div className="gh-title">
        Export a chart's data as CSV, with the active filters <span className="gh-num">#21</span>
      </div>
      <span className="gh-state" data-tone="open">
        <Octicon name="issue" size={14} />
        Open
      </span>

      <div className="gh-timeline">
        <Collapse open={!s.spec}>
        <div className="gh-box gh-req">
          <div className="gh-box-head">
            <Avatar name="juhyeonni" size={18} />
            <b>juhyeonni</b> opened 2h ago
          </div>
          <div className="gh-box-body">
            <div className="gh-ai">This was generated by AI while planning, not yet triaged.</div>
            <div className="gh-spec-sub">What problem does this solve?</div>
            <div>People copy numbers out of a chart by hand. They want the data as a file.</div>
            <div className="gh-spec-sub">What would you like to happen?</div>
            <div>A chart can be exported as CSV, with the filters that are active.</div>
            <div className="gh-spec-sub">How was this opened?</div>
            <div>I need this myself</div>
          </div>
        </div>
        </Collapse>

        <Collapse open={s.labels} reveal="drop">
          <div className="gh-item">
          <Event icon="tag">
            <b>juhyeonni</b> added
            <span className="gh-label" data-l="p1">P1</span>
            <span className="gh-label" data-l="ready">ready-for-agent</span>
            <span className="gh-label" data-l="source">source:requester</span>
          </Event>
          </div>
        </Collapse>

        <Collapse open={s.spec} reveal="drop">
          <div className="gh-item">
          <div className="gh-box gh-pinned">
            <div className="gh-pin-head">
              <Octicon name="pin" size={14} />
              Pinned by juhyeonni
            </div>
            <div className="gh-box-body gh-spec">
              <div className="gh-spec-h">Spec</div>
              <div>
                <b>Goal:</b> A chart's data downloads as a CSV file that holds the rows the chart shows.
              </div>
              <div className="gh-spec-sub">Decisions</div>
              <div>D1. The file holds the filtered rows: the same rows the chart shows.</div>
              <div className="gh-spec-sub">Acceptance criteria</div>
              <div className="gh-task">
                <span className="gh-box-check" />
                AC1. The file has one row per row the chart shows · check: test
              </div>
              <div className="gh-task">
                <span className="gh-box-check" />
                AC2. Changing a filter changes the file's rows · check: test
              </div>
              <div className="gh-task">
                <span className="gh-box-check" />
                AC3. A cell with a comma is quoted · check: test
              </div>
              <div className="gh-spec-sub">Out of scope</div>
              <div>Excel files, scheduled exports</div>
            </div>
          </div>
          </div>
        </Collapse>

        <Collapse open={s.pr} reveal="drop">
          <div className="gh-item">
          <Event icon="pr">
            <b>juhyeonni</b> linked a pull request that will close this issue
            <span className="gh-pr-ref">
              Export a chart as CSV <span className="gh-num">#26</span>
              <span className="gh-draft">Draft</span>
            </span>
          </Event>
          </div>
        </Collapse>

        <Collapse open={!s.spec}>
        <div className="gh-composer">
          <div className="gh-composer-title">Add a comment</div>
          <div className="gh-composer-box">Use Markdown to format your comment</div>
          <div className="gh-composer-actions">
            <Button size="small">Comment</Button>
          </div>
        </div>
        </Collapse>
      </div>
    </div>
  )
}

function PrPage({ body }: { body: boolean }) {
  return (
    <div className="gh-pg" data-name="pr">
      <div className="gh-title">
        Export a chart as CSV <span className="gh-num">#26</span>
      </div>
      <div className="gh-pr-meta">
        <span className="gh-state" data-tone="draft">
          <Octicon name="pr" size={14} />
          Draft
        </span>
        <span>
          <b>juhyeonni</b> wants to merge 3 commits into <code>main</code> from <code>21-export-csv</code>
        </span>
      </div>

      <div className="gh-timeline gh-stack">
        <Collapse open={body}>
        <div className="gh-box">
          <div className="gh-box-body gh-spec gh-prbody">
            <div>Closes #21</div>
            <div className="gh-spec-sub">What and why</div>
            <div>Adds an Export CSV button to a chart. The file holds the rows the chart shows.</div>
            <div className="gh-spec-sub">Decisions</div>
            <div>The file follows the active filters · matches the chart (D1, in the spec)</div>
            <div className="gh-spec-sub">Review focus</div>
            <div><b>Look at:</b> how filtered rows are built · <b>Risky:</b> cells with commas · <b>Skim:</b> button styling</div>
            <div className="gh-spec-sub">Evidence</div>
            <div><b>Before:</b> no export button · <b>After:</b> 3 new tests pass</div>
            <div className="gh-spec-sub">Merge Danger</div>
            <div><b>Door:</b> two-way · <b>Blast Radius:</b> one chart menu</div>
          </div>
        </div>
        </Collapse>

        <div className="gh-box">
          <div className="gh-box-head">
            <Avatar name="juhyeonni" size={18} />
            <b>juhyeonni</b> commented
          </div>
          <div className="gh-box-body gh-verdict">
            <div className="gh-verdict-h">
              <span className="gh-pass">
                <Octicon name="checkCircle" size={16} />
              </span>
              Verify: PASS (round 1 of 3)
            </div>
            <div>
              <b>Criteria:</b> 3 ran, 0 read, 0 manual
            </div>
            <div>This PR can merge. Read this verdict, mark the draft "Ready for review", then merge. Nothing to decide first.</div>
            <div>No manual checks</div>
            <div className="gh-verdict-sub">Security</div>
            <div>No findings.</div>
          </div>
        </div>

        <div className="gh-box gh-merge">
          <span className="gh-merge-icon">
            <Octicon name="pr" size={16} />
          </span>
          <div className="gh-merge-text">
            <b>This pull request is still a work in progress</b>
            <span>Draft pull requests cannot be merged.</span>
          </div>
          <Button size="small">Ready for review</Button>
        </div>
      </div>
    </div>
  )
}

// Claude Code's welcome box, as the hero-demo gold draws it.
function Welcome() {
  const mono = 'ui-monospace, SFMono-Regular, monospace'
  return (
    <svg viewBox="0 0 240 64" fill="none" className="mlt-welcome">
      <rect x="1" y="1" width="150" height="62" rx="3" stroke="#D97757" strokeWidth="1.2" fill="none" />
      <text x="160" y="14" fill="rgba(0,0,0,0.7)" fontSize="8.5" fontFamily={mono} fontWeight="500">Claude Code</text>
      <text x="160" y="25" fill="rgba(0,0,0,0.4)" fontSize="7" fontFamily={mono}>v2.1.300</text>
      <text x="76" y="15" fill="rgba(0,0,0,0.6)" fontSize="7.5" fontFamily={mono} textAnchor="middle">Welcome back!</text>
      <g transform="translate(54, 20) scale(0.3)">
        <path d="M104.998 0H20.998V16.2H104.998V0Z" fill="#D77757" />
        <path d="M34.998 16.1953H20.998V32.3953H34.998V16.1953Z" fill="#D77757" />
        <rect x="35" y="14.7266" width="56" height="29.4545" fill="black" />
        <path d="M84 14.7266H42V36.8175H84V14.7266Z" fill="#D77757" />
        <path d="M105.002 16.1953H91.002V32.3953H105.002V16.1953Z" fill="#D77757" />
        <path d="M119 32.4023H7V48.6023H119V32.4023Z" fill="#D77757" />
        <path d="M104.998 48.5977H20.998V64.7977H104.998V48.5977Z" fill="#D77757" />
        <path d="M35 64.8047H28V81.0047H35V64.8047Z" fill="#D77757" />
        <path d="M49 64.8047H42V81.0047H49V64.8047Z" fill="#D77757" />
        <path d="M84 64.8047H77V81.0047H84V64.8047Z" fill="#D77757" />
        <path d="M98.002 64.8047H91.002V81.0047H98.002V64.8047Z" fill="#D77757" />
      </g>
      <text x="76" y="56" fill="rgba(0,0,0,0.4)" fontSize="6.5" fontFamily={mono} textAnchor="middle">Opus 5.5 · ~/metrics-dashboard</text>
    </svg>
  )
}
