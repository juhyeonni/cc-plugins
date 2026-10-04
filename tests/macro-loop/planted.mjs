// Measures whether the verifiers' reports name slop planted in a seed (#62). It is a
// measurement, not a check: it never decides a pass.

// The report of the last verifier started for an axis, from `loadReports`.
export function axisReport(reports, axis) {
  const runs = reports.filter((r) => r.agentType === 'macro-loop:verifier' && r.prompt.trim().split('\n')[0] === `Axis: ${axis}`)
  return runs.at(-1)?.report ?? null
}

// Per item, whether its pattern is in its axis' report; null when that axis has no report.
export function namedItems(planted, reports) {
  return Object.fromEntries(
    planted.map(({ name, axis, pattern }) => {
      const report = axisReport(reports, axis)
      return [name, report == null ? null : pattern.test(report)]
    }),
  )
}
