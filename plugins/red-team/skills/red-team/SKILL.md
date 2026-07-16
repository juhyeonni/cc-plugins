---
name: red-team
description: >-
  Adversarially review a document or code diff AS a specific persona (a target
  reader/user with concrete knowledge gaps), via a fresh-eyes subagent, and loop
  review → fix → re-review until it passes. Use when the user says "red-team
  this", "review as <persona>", "how would <a novice / an inheriting maintainer /
  an attacker> read this", "poke holes in this doc/PR from X's perspective",
  "적대적으로 리뷰", or wants a review the author's own context would be blind to.
  Manages reusable personas (inline / project file / memory).
---

# red-team

Run a **red-team review**: become a specific reader/user, read the artifact as them, and report where they get stuck, misled, endangered, or confused — then fix and re-check.

**Why a subagent, not just me:** the review runs as the `red-teamer` subagent in a **fresh context**. The context that wrote (or has been editing) the artifact carries the author's blind spots; a fresh reader does not. Do **not** skip this — reviewing in the authoring context defeats the whole purpose.

**A review is only as good as its persona.** "Review this" with no persona → weak, generic findings. "Review this as someone who has only ever used the online editor and is inheriting a live production system" → sharp, real findings.

## Procedure

### 1. Resolve the persona

Pick the persona by this precedence (first match wins):

1. **Inline** — the user described or named one in the request. Use it.
2. **Project file** — `.claude/red-team/personas/<name>.md` in the target repo (team-shareable, versioned). If the user named a saved persona, load it.
3. **Memory default** — a personal default persona saved in memory (e.g. under `red-team/personas/<name>`) from a previous session.

**Resolution:** if a persona is found in any source, name the one you're using and proceed (the user can override). **Only ask when none is found anywhere** — then have the user pick a saved persona or describe one (role, what they know, what they *don't* know, their scenario, what makes them fail), using [`personas/_TEMPLATE.md`](personas/_TEMPLATE.md) as the shape.

When the user defines a *new* persona, **offer to save it** — to `.claude/red-team/personas/` (for the team) or to memory (personal) — so it is reusable next time.

### 2. Identify the artifact

The target is a whole doc, a section, a file, or a code diff. For a diff, confirm which one (unstaged / staged / vs a base branch like `main`) and capture the exact `git diff` output or command. Confirm the scope if it is ambiguous.

### 3. Review with fresh eyes

Invoke the **`red-teamer` subagent** (registered as `red-teamer`), passing it:

- the resolved persona — paste it if it was inline, or give the file path if saved; and
- the artifact — paste the text, or give file paths + the captured diff.

For a whole multi-part artifact, tell it to also use **integrated-review mode**.

If the `red-teamer` subagent is not available in this session (e.g. the plugin's agent isn't loaded), **do not silently review inline** — that reintroduces the author's blind spots. Tell the user the `red-team` agent isn't loaded and stop, or ask them to enable the plugin.

### 4. Report

Relay the subagent's findings faithfully: severity-ranked, each with location + the persona's reaction + a concrete fix, then the `PASS` / `NEEDS-FIX` verdict.

**Honor the honesty rule.** If the subagent returns `PASS`, tell the user it is solid and **stop** — do not invent another round. Surface only genuine residuals, marked optional.

### 5. Fix-loop

If the user wants, **apply the fixes**, then **re-run step 3** (the subagent, fresh again) to confirm the fixes hold and introduced nothing new. Repeat until `PASS` or the user stops. Diminishing returns are real: once findings drop to optional polish, say so and recommend stopping.

## Personas

- **Template:** [`personas/_TEMPLATE.md`](personas/_TEMPLATE.md)
- **Example:** [`personas/example-legacy-maintainer.md`](personas/example-legacy-maintainer.md)
- Project personas live in the *target* repo at `.claude/red-team/personas/`; personal defaults live in memory.

A good persona names the **gaps** (what they don't know) and the **scenario** (their situation) — those, not the job title, are what surface real findings.
