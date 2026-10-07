export const meta = {
  name: 'execute-verify',
  description: 'macro-loop execute (#111): judge each PR with two fresh-context verifiers (spec, standards), in parallel. Posts nothing.',
  phases: [{ title: 'verify', detail: 'two macro-loop:verifier agents per Issue, each in its own worktree' }],
}

// args: { base, issues: [{ number, spec, head, runSpecCommands }] }
// Each verifier gets verify's identifier lines and nothing else (skills/verify step 5).
// Returns one { number, spec, standards } per Issue: each the verifier's report, or null.
const lines = (i, axis) => [
  `Axis: ${axis}`,
  `Issue: #${i.number}`,
  `Spec comment: ${i.spec ?? 'none'}`,
  `Base: ${args.base}`,
  `Head: ${i.head}`,
  ...(axis === 'spec' ? [`Run spec commands: ${i.runSpecCommands ? 'yes' : 'no'}`, 'Run tests and lint: yes'] : []),
].join('\n')

const verifier = (i, axis) =>
  agent(lines(i, axis), { label: `verify · ${axis}`, phase: `#${i.number}`, agentType: 'macro-loop:verifier', isolation: 'worktree' })

const results = await parallel(args.issues.map((i) => () =>
  parallel([() => verifier(i, 'spec'), () => verifier(i, 'standards')])
    .then(([spec, standards]) => ({ number: i.number, spec: spec ?? null, standards: standards ?? null }))
))

return args.issues.map((i, k) => results[k] ?? { number: i.number, spec: null, standards: null })
