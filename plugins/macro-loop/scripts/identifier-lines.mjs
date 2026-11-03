// The lines a verifier starts with (ADR-0004), and nothing else: verify's template (skills/verify
// step 5) and the workflow's verifier prompt (workflows/execute-run.js, which may not import this)
// use only these. The hook, verifier-flags.mjs, refuses a verifier prompt with any other line.
export const IDENTIFIER_LINES = [
  /^Axis: (spec|standards)$/,
  /^Issue: #\d+$/,
  /^Spec comment: (\d+|none)$/,
  /^Also closes: (none|#\d+(, #\d+)*)$/,
  /^Base: \S+$/,
  /^Head: [0-9a-f]{7,40}$/,
  /^Run spec commands: (yes|no)$/,
  /^Run tests and lint: (yes|no)$/,
]

export const isIdentifierLine = (line) => IDENTIFIER_LINES.some((re) => re.test(line))
