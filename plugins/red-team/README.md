# Red-Team Review

Adversarial, **fresh-eyes** review of a document or code diff, from the perspective of a specific **persona** — then a fix-loop until it passes.

## Why

The context that wrote an artifact has blind spots. This plugin runs the review in a separate subagent (`red-teamer`) with a **fresh context**, driven by a concrete persona (a reader/user with real knowledge gaps). Sharp personas produce sharp findings; a generic "review this" does not.

## Use

- "Red-team this doc as `legacy-maintainer`."
- "Review this PR as a security engineer who doesn't trust our inputs."
- "How would a first-day maintainer read section 7?"

The `red-team` skill:

1. **Resolves the persona** — inline → `.claude/red-team/personas/*.md` (project, team-shareable) → memory (personal). If none, it asks.
2. **Reviews with fresh eyes** — invokes the `red-teamer` subagent with the persona + the artifact.
3. **Reports** severity-ranked findings, each with location + the persona's reaction + a concrete fix, and a `PASS` / `NEEDS-FIX` verdict.
4. **Fix-loops** — applies fixes and re-reviews (fresh again) until `PASS`.

## Contents

| Path | What |
|---|---|
| `skills/red-team/SKILL.md` | Orchestration: persona resolution, fix-loop, integrated review. |
| `agents/red-teamer.md` | The fresh-eyes reviewer, with a built-in **honesty rule**. |
| `skills/red-team/personas/_TEMPLATE.md` | Persona template. |
| `skills/red-team/personas/example-legacy-maintainer.md` | Worked example persona. |

## Design notes

- **Honesty rule** — the reviewer must not manufacture findings. Declaring "no blockers, ship it" is a valid and valued result; inflating severity to justify another round is a failure mode it is told to avoid.
- **Persona precedence** — inline > project file > memory.
- **Integrated mode** — for whole multi-part artifacts, it also checks contradictions / duplication / broken cross-references / term usage / staleness (things per-section review misses).

## Install

Add the marketplace first (see the [repo README](../../README.md)), then:

```
/plugin install red-team@juhyeonni
```

Restart Claude Code after installing.

For local testing:

```bash
claude --plugin-dir ./plugins/red-team
```
