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
const stageOut = (stage: string) => JSON.stringify({ stage, why: '', gate: true }) + '\n'
const TRUST_OUT = JSON.stringify({
  configFile: null, config: {}, trusted: ['o'],
  pr: { number: 109, closes: 12, lastVerdict: 777, lastVerdictResult: 'PASS', lastVerdictSha: null, round: 2 },
  issue: { number: 12, spec: 555 },
}) + '\n'

// The engine beneath the plugin: its clock, surfaces, own drawing, a Bash that answers
// stage.mjs (merge for #12, wait for #101) and trust.mjs, and the host's
// `git remote get-url origin` (none by default).
async function setup($: any, on: any, remote = '', runs: unknown[] = []) {
  const clock = mock.clock(on)
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: SESSION.cwd }))
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('ui.render', () => ({ type: 'Text', children: [''] }))
  on('process.run', (_$: any, e: any) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    return { value: remote
      ? { exitCode: 0, stdout: `${remote}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 2, stdout: '', stderr: 'error: No such remote', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, (_$: any, e: any) => ({
    result: {
      stdout: /trust\.mjs/.test(e.command) ? TRUST_OUT : stageOut(/--issue 101/.test(e.command) ? 'wait' : 'merge'),
      stderr: '',
      interrupted: false,
    },
  }))
  await $.session.start(SESSION)
  return clock
}

const mount = ($: any, surface: 'terminal' | 'desktop', isWorking = false) =>
  $.ui.mount({ ...BAND, plugin: PLUGIN, surface, props: { ...PROPS, isWorking } })
const cell = async (ui: any, key: string) => (await ui.find({ key }))?.text

test('the band follows next on every surface that draws it', async ($, on) => {
  await setup($, on)

  const fresh = await mount($, 'terminal')
  expect(await fresh.find({ key: 'r0' })).toBeUndefined()
  await fresh.unmount()

  await $.skill.prompt({ skill: 'macro-loop:next', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 12' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await cell(ui, 'r0-symbol')).toBe('◆')
    expect(await cell(ui, 'r0-number')).toBe('#12')
    expect(await cell(ui, 'r0-track')).toBe('●●●●●◐')
    expect(await cell(ui, 'r0-stage')).toBe('merge')
    expect(await cell(ui, 'r0-action')).toBe('merge the PR')
    await ui.unmount()

    const working = await mount($, surface, true)
    expect(await cell(working, 'r0-symbol')).toBe('▶')
    expect(await working.find({ key: 'r0-action' })).toBeUndefined()
    await working.unmount()
  }
})

test('each Issue of the session gets its own row, the current one first', async ($, on) => {
  await setup($, on)

  await $.skill.prompt({ skill: 'macro-loop:next', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 12' })
  await $.skill.prompt({ skill: 'macro-loop:next', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 101' })

  const ui = await mount($, 'terminal')
  expect(await cell(ui, 'r0-number')).toBe('#101')
  expect(await cell(ui, 'r0-symbol')).toBe('◇')
  expect(await cell(ui, 'r0-action')).toBe('(requester)')
  expect(await cell(ui, 'r1-number')).toBe('#12')
  expect(await cell(ui, 'r1-action')).toBe('merge the PR')
  await ui.unmount()
})

test('the elapsed time moves on the timer alone', async ($, on) => {
  const clock = await setup($, on)

  await $.skill.prompt({ skill: 'macro-loop:verify', text: '' })
  const ui = await mount($, 'terminal', true)
  expect(await cell(ui, 'r0-time')).toBe('0m')

  await clock.advance(60_000)
  expect(await cell(ui, 'r0-time')).toBe('1m')
  await ui.unmount()

  const again = await mount($, 'terminal', true)
  expect(await cell(again, 'r0-time')).toBe('1m')
  await again.unmount()
})

test('a drawn band links the Issue and each document seen, on the remote read once', async ($, on) => {
  const runs: unknown[] = []
  await setup($, on, 'git@github.com:o/r.git', runs)

  await $.skill.prompt({ skill: 'macro-loop:verify', text: '' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/trust.mjs" --pr 109' })
  await $.tool.call({ tool: 'Bash', command: 'node "/x/macro-loop/scripts/stage.mjs" --issue 12' })

  const ui = await mount($, 'terminal')
  expect(await cell(ui, 'r0-action')).toBe('merge the PR')
  const links = await ui.findAll({ type: 'Link' })
  expect(links.map((l: any) => l.props.href)).toEqual([
    'https://github.com/o/r/issues/12',
    'https://github.com/o/r/issues/12#issuecomment-555',
    'https://github.com/o/r/pull/109',
    'https://github.com/o/r/pull/109#issuecomment-777',
  ])
  expect(links.map((l: any) => l.props.label)).toEqual(['#12', '[Spec]', '[PR#109]', '[Verdict]'])
  await ui.unmount()
  expect(runs).toEqual([{ argv: ['git', 'remote', 'get-url', 'origin'], cwd: '/work' }])
})
