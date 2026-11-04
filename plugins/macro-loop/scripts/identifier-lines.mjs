// The lines each reviewer agent starts with (ADR-0004), and nothing else: verify's template
// (skills/verify step 5) and the workflow's prompts (workflows/execute-run.js, which may not
// import this) use only these. The hook, verifier-flags.mjs, refuses a reviewer prompt with any
// other line. The security reviewer judges the PR, not an Issue, so it gets no Issue line (#197).
export const IDENTIFIER_LINES = {
  'macro-loop:verifier': [
    /^Axis: (spec|standards)$/,
    /^Issue: #\d+$/,
    /^Spec comment: (\d+|none)$/,
    /^Also closes: (none|#\d+(, #\d+)*)$/,
    /^Base: \S+$/,
    /^Head: [0-9a-f]{7,40}$/,
    /^Answers: (none|\d+@[0-9a-f]{7,40}(, \d+@[0-9a-f]{7,40})*)$/,
    /^Run spec commands: (yes|no)$/,
    /^Run tests and lint: (yes|no)$/,
  ],
  'macro-loop:security-reviewer': [/^Axis: security$/, /^Base: \S+$/, /^Head: [0-9a-f]{7,40}$/],
}

// The agents the hooks hold to these rules.
export const REVIEWERS = Object.keys(IDENTIFIER_LINES)

export const isIdentifierLine = (line, agent = 'macro-loop:verifier') => IDENTIFIER_LINES[agent].some((re) => re.test(line))
