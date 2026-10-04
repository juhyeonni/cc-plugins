// Measures whether the verifiers' reports name slop planted in a seed (#62). It is a
// measurement, not a check: it never decides a pass.

// The report of the last verifier started for an axis: the result of its Agent call.
export function axisReport(calls, axis) {
  const spawns = calls.filter(
    (c) => c.tool === 'Agent' && c.input?.subagent_type === 'macro-loop:verifier' && String(c.input.prompt ?? '').trim().split('\n')[0] === `Axis: ${axis}`,
  )
  return spawns.at(-1)?.result ?? null
}

// Per item, whether its pattern is in its axis' report; null when that axis has no report.
export function namedItems(planted, calls) {
  return Object.fromEntries(
    planted.map(({ name, axis, pattern }) => {
      const report = axisReport(calls, axis)
      return [name, report == null ? null : pattern.test(report)]
    }),
  )
}
