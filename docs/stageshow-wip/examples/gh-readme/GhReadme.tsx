import { Collapse, Stage, States, Text, Tooltip, Window, type Act } from '../../kit'
import { Octicon, type OcticonName } from './octicons'
import './gh.css'

// The cc-plugins README on GitHub: copy the Setup command, paste it into
// Claude Code, then install a plugin from the table.

type S = {
  copied: boolean
  terminal: boolean
  input: string
  added: boolean
  addOut: boolean
  installed: boolean
  installOut: boolean
}

const initial: S = { copied: false, terminal: false, input: '', added: false, addOut: false, installed: false, installOut: false }

const ADD = '/plugin marketplace add juhyeonni/cc-plugins'
const INSTALL = '/plugin install macro-loop@juhyeonni'

const POSTER: S = { copied: true, terminal: true, input: '', added: true, addOut: true, installed: true, installOut: true }
const REST = { wide: { x: 250, y: 300 }, compact: { x: 200, y: 60 } }

async function script(a: Act<S>) {
  await a.wait(700)

  // Copy the Setup command from the README
  await a.move('copy')
  await a.wait(300)
  await a.click()
  await a.set({ copied: true })
  await a.wait(900)

  // Claude Code comes forward; paste and run it
  await a.set({ terminal: true })
  await a.wait(700)
  await a.click('term-input')
  await a.key('cmd+v')
  await a.set({ input: ADD })
  await a.wait(500)
  await a.key('enter')
  await a.set({ input: '', added: true })
  await a.wait(700)
  await a.set({ addOut: true })
  await a.wait(900)

  // Install a plugin from the table
  await a.type('input', INSTALL)
  await a.wait(300)
  await a.key('enter')
  await a.set({ input: '', installed: true })
  await a.wait(800)
  await a.set({ installOut: true })
  await a.move('rest')
  await a.wait(2400)

  // Claude Code closes; the README is back as it began
  await a.set({ terminal: false, copied: false })
  await a.wait(500)
  await a.snap({ ...initial })
  await a.wait(500)
}

export function GhReadme() {
  return (
    <Stage width={760} height={420} compact={{ below: 600, width: 358, height: 356 }} initial={initial} poster={POSTER} script={script} cursor={{ at: REST }} fidelity="realistic" className="gh">
      {(s, rect, layout) => (
        <>
          <Window url="github.com/juhyeonni/cc-plugins" nav className="gh-browser" receded={s.terminal}>
            <div className="gh-page">
              <div className="gh-readme">
                <div className="gh-readme-head">
                  <span className="gh-tab" data-active>
                    <Octicon name="book" />
                    README
                  </span>
                  <span className="gh-tab">
                    <Octicon name="law" />
                    MIT license
                  </span>
                  <span className="gh-tab-end">
                    <Octicon name="list" />
                  </span>
                </div>

                <div className="gh-md">
                  <div className="gh-h2">Setup</div>
                  <div className="gh-p">Run once inside a Claude Code session:</div>
                  <div className="gh-pre">
                    <code>{ADD}</code>
                    <span className="gh-copy" data-target="copy" data-cursor="pointer" data-copied={s.copied || undefined}>
                      <States value={s.copied ? 'check' : 'copy'} states={{ copy: <Octicon name="copy" />, check: <Octicon name="check" /> }} />
                    </span>
                  </div>
                  <div className="gh-p gh-after">
                    After that, manage everything from <code className="gh-code">/plugin</code>.
                  </div>
                  <div className="gh-h2">Plugins</div>
                  <div className="gh-table" data-crop>
                    <div className="gh-tr gh-th">
                      <span>Plugin</span>
                      <span>Version</span>
                      <span>Install</span>
                    </div>
                    <div className="gh-tr">
                      <span className="gh-link">macro-loop</span>
                      <span>0.9.4</span>
                      <code className="gh-code">{INSTALL}</code>
                    </div>
                    <div className="gh-tr">
                      <span className="gh-link">red-team</span>
                      <span>0.1.1</span>
                      <code className="gh-code">/plugin install red-team@juhyeonni</code>
                    </div>
                  </div>
                </div>
              </div>

              {layout === 'wide' && (
                <aside className="gh-about">
                  <div className="gh-about-title">About</div>
                  <div className="gh-about-desc">My personal Claude Code plugin marketplace</div>
                  {(
                    [
                      ['book', 'Readme'],
                      ['law', 'MIT license'],
                      ['pulse', 'Activity'],
                      ['star', '1 star'],
                      ['fork', '0 forks'],
                    ] as [OcticonName, string][]
                  ).map(([icon, label]) => (
                    <div key={label} className="gh-about-row">
                      <Octicon name={icon} />
                      <Text filler>{label}</Text>
                    </div>
                  ))}
                  <div className="gh-about-section">
                    <div className="gh-about-title">Releases</div>
                    <div className="gh-about-note">No releases published</div>
                  </div>
                  <div className="gh-about-section">
                    <div className="gh-about-title">
                      Contributors <span className="gh-counter">2</span>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </Window>

          {/* GitHub opens this one to the west of the button */}
          <Tooltip show={s.copied && !s.terminal} at={{ x: rect('copy').x, y: rect('copy').y + rect('copy').height / 2, width: 0.01, height: 0 }} gap={0} className="gh-tip">
            Copied!
          </Tooltip>

          <Window title={layout === 'wide' ? '~/my-app — claude' : 'claude'} className="gh-term" data-show={s.terminal}>
            <div className="gh-term-body">
              <Welcome />
              <Collapse open={s.added}>
                <div className="gh-line gh-cmd">&gt; {ADD}</div>
              </Collapse>
              <Collapse open={s.addOut}>
                <div className="gh-line gh-out">
                  ⎿&nbsp; Successfully added marketplace: <b>juhyeonni</b>
                </div>
              </Collapse>
              <Collapse open={s.installed}>
                <div className="gh-line gh-cmd">&gt; {INSTALL}</div>
              </Collapse>
              <Collapse open={s.installOut}>
                <div className="gh-line gh-out">
                  ⎿&nbsp; <span className="gh-ok">✓</span> Installed <b>macro-loop</b>
                </div>
                <div className="gh-line gh-out gh-dim">&nbsp;&nbsp;&nbsp;Restart Claude Code to load new plugins.</div>
              </Collapse>
              <div className="gh-input" data-target="term-input" data-cursor="ibeam" data-snap>
                <span className="gh-sigil">&gt;</span>
                <span className="gh-typed">
                  {s.input}
                  <span className="gh-caret">█</span>
                </span>
              </div>
            </div>
          </Window>
          <span data-target="rest" style={{ position: 'absolute', left: REST[layout].x, top: REST[layout].y }} />
        </>
      )}
    </Stage>
  )
}

// Claude Code's welcome box, as the hero-demo gold draws it.
function Welcome() {
  const mono = 'ui-monospace, SFMono-Regular, monospace'
  return (
    <svg viewBox="0 0 240 64" fill="none" className="gh-welcome">
      <rect x="1" y="1" width="150" height="62" rx="3" stroke="#D97757" strokeWidth="1.2" fill="none" />
      <text x="160" y="14" fill="rgba(0,0,0,0.7)" fontSize="8.5" fontFamily={mono} fontWeight="500">
        Claude Code
      </text>
      <text x="160" y="25" fill="rgba(0,0,0,0.4)" fontSize="7" fontFamily={mono}>
        v2.1.300
      </text>
      <text x="76" y="15" fill="rgba(0,0,0,0.6)" fontSize="7.5" fontFamily={mono} textAnchor="middle">
        Welcome back!
      </text>
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
      <text x="76" y="56" fill="rgba(0,0,0,0.4)" fontSize="6.5" fontFamily={mono} textAnchor="middle">
        Opus 5.5 · ~/my-app
      </text>
    </svg>
  )
}
