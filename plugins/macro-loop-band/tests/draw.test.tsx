// The band drawn through the engine from real-shaped events (#108). Run with
// `claude plugin test plugins/macro-loop-band`; the pure rules are in tests/macro-loop-band.
import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'macro-loop-band'
const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 115,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}
const BAND = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 40, isFullscreen: false },
  props: PROPS,
} as const
const STAGE_OUT = '{"stage":"merge","why":"the verdict for the current head is PASS","gate":true}\n'
const TRUST_OUT = JSON.stringify({
  configFile: null, config: {}, trusted: ['o'],
  pr: { number: 109, closes: 12, lastVerdict: 777, lastVerdictResult: 'PASS', lastVerdictSha: null, round: 2 },
  issue: { number: 12, spec: 555 },
}) + '\n'

// The engine beneath the plugin: its clock, surfaces, own drawing, a Bash that answers
// stage.mjs and trust.mjs, and the host's `git remote get-url origin` (none by default).
async function setup($: any, on: any, decision = 'allow', remote = '', runs: unknown[] = []) {
  const clock = mock.clock(on)
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: SESSION.cwd }))
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  on('tool.check', () => ({ decision }))
  on('ui.render', () => ({ type: 'Text', children: [''] }))
  on('process.run', (_$: any, e: any) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    return { value: remote
      ? { exitCode: 0, stdout: `${remote}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 2, stdout: '', stderr: 'error: No such remote', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, (_$: any, e: any) =>
    ({ result: { stdout: /trust\.mjs/.test(e.command) ? TRUST_OUT : STAGE_OUT, stderr: '', interrupted: false } }))
  await $.session.start(SESSION)
  return clock
}

const mount = ($: any, surface: 'terminal' | 'desktop', isWorking = false) =>
  $.ui.mount({ ...BAND, plugin: PLUGIN, surface, props: { ...PROPS, isWorking } })

test('the band follows next on every surface that draws it', async ($, on) => {
  await setup($, on)

  const fresh = await mount($, 'terminal')
  expect(await fresh.find({ type: 'Text', text: /#/ })).toBeUndefined()
  await fresh.unmount()

  await $.skill.prompt({ skill: 'macro-loop:next', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 12' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /◆ #12 PASS · read verdict, merge the PR/ })).toBeDefined()
    await ui.unmount()

    const working = await mount($, surface, true)
    expect(await working.find({ type: 'Text', text: /▶ #12 next/ })).toBeDefined()
    await working.unmount()
  }
})

test('the elapsed time moves on the timer alone', async ($, on) => {
  const clock = await setup($, on)

  await $.skill.prompt({ skill: 'macro-loop:verify', text: '' })
  const ui = await mount($, 'terminal', true)
  expect((await ui.find({ type: 'Text', text: /▶/ }))?.text).toBe('▶ verify · 0m')

  await clock.advance(60_000)
  expect((await ui.find({ type: 'Text', text: /▶/ }))?.text).toBe('▶ verify · 1m')
  await ui.unmount()

  const again = await mount($, 'terminal', true)
  expect((await again.find({ type: 'Text', text: /▶/ }))?.text).toBe('▶ verify · 1m')
  await again.unmount()
})

test('an approved call returns the band to ▶ once its progress row draws', async ($, on) => {
  let id = ''
  let release = () => {}
  const held = new Promise<void>((r) => { release = r })
  let asked = () => {}
  const isAsked = new Promise<void>((r) => { asked = r })
  // The engine beneath: decides with an ask, then holds the approved call while it runs.
  on('tool.call', { tool: 'Bash' }, async (_$: any, e: any, next: any) => {
    if (e.command !== 'npm test') return next(e)
    id = e.tool_use_id
    await $.tool.check({ tool: 'Bash', input: { command: e.command }, tool_use_id: id } as any)
    asked()
    await held
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await setup($, on, 'ask')

  await $.skill.prompt({ skill: 'macro-loop:verify', text: '' })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await isAsked
  const ui = await mount($, 'terminal', true)
  expect((await ui.find({ type: 'Text', text: /verify/ }))?.text).toBe('◆ verify · approve the tool call')
  await ui.unmount()

  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolProgress', requestId: id,
    viewport: BAND.viewport, props: { tool_use_id: id, kind: 'background_hint' } } as any)
  await row.unmount()
  const after = await mount($, 'terminal', true)
  expect((await after.find({ type: 'Text', text: /verify/ }))?.text).toBe('▶ verify · 0m')
  await after.unmount()
  release()
  await call
})

test('a drawn band links the PR and the verdict on the remote read once', async ($, on) => {
  const runs: unknown[] = []
  await setup($, on, 'allow', 'git@github.com:o/r.git', runs)

  await $.skill.prompt({ skill: 'macro-loop:verify', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/trust.mjs" --pr 109' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 12' })

  const ui = await mount($, 'terminal')
  expect((await ui.find({ type: 'Text', text: /◆ #12/ }))?.text).toMatch(/^◆ #12 PASS · read verdict, merge the PR/)
  const links = await ui.findAll({ type: 'Link' })
  expect(links.map((l) => l.props.href)).toEqual(['https://github.com/o/r/pull/109', 'https://github.com/o/r/pull/109#issuecomment-777'])
  expect(links.map((l) => l.props.label)).toEqual(['PR #109', 'verdict'])
  await ui.unmount()
  expect(runs).toEqual([{ argv: ['git', 'remote', 'get-url', 'origin'], cwd: '/work' }])
})
