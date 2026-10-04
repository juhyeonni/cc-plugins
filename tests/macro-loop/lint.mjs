// Records whether a verifier ran lint at Head and at Base (#61), so a PASS on a change
// that adds a lint violation can be put down to how step 2 of the spec axis is read,
// not to a skipped step. It is a measurement, not a check: it never decides a pass.

// A detached checkout, or a lint command, in the order they appear in a command.
const STEP = /git\s+checkout\s+--detach\s+(\S+)|npm\s+run\s+lint\b|node\s+scripts\/lint\.js\b/g

// A full sha matches its abbreviation; a ref such as origin/seed/lint-base matches only itself.
const names = (target, refs) => refs.some((r) => r === target || (/^[0-9a-f]{7,40}$/.test(target) && r.startsWith(target)))

// `sides` holds, per side, the refs and shas that name it: { head: [...], base: [...] }.
export function lintSides(calls, sides) {
  const ran = { head: false, base: false }
  const byAgent = new Map()
  for (const c of calls.filter((c) => c.agentType === 'macro-loop:verifier' && c.tool === 'Bash')) {
    if (!byAgent.has(c.agent)) byAgent.set(c.agent, [])
    byAgent.get(c.agent).push(c.command)
  }
  for (const commands of byAgent.values()) {
    // The worktree may start on any commit, so lint before a checkout counts at neither side.
    let at = null
    for (const command of commands) {
      for (const [, target] of String(command).matchAll(STEP)) {
        if (target) at = target
        else if (at && names(at, sides.head)) ran.head = true
        else if (at && names(at, sides.base)) ran.base = true
      }
    }
  }
  return ran
}
