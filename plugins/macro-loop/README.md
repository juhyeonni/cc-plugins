# Macro Loop

**A regular routine for AI-assisted development on GitHub Issues.**

## Why

Requests arrive in different shapes, stages get skipped, and the agent that wrote a change is often the one that checks it. Macro Loop gives the work a fixed set of stages around a GitHub Issue, one skill per stage:

```text
Issue → triage → grilling → spec → implement → open-pr → verify → merge
```

Any stage can be the entry point. When a stage's input is missing, the skill warns and asks. If you go ahead, it records the gap on the Issue as a `skipped:*` label, so skipped stages can be counted later instead of disappearing. GitHub Free private repos cannot enforce required checks, so the routine records rather than blocks.

## Use

| Skill | What it does | Leaves behind |
|---|---|---|
| `/macro-loop:init` | Optional setup: labels, bug and feature Issue templates, `.claude/macro-loop.json` | Labels and files |
| `/macro-loop:triage` | Proposes a priority, a state and a source for each Issue, and applies them after approval | Labels |
| `/macro-loop:grilling` | Interviews you until every decision is settled | Decisions in the conversation |
| `/macro-loop:spec` | Writes the spec: goal, decisions with reasons, testable acceptance criteria, out of scope | A pinned Issue comment |
| `/macro-loop:implement` | Builds what the spec asks for, commits, and hands over to `open-pr` and `verify` | Commits |
| `/macro-loop:open-pr` | Pushes the branch and opens the PR with `Closes #n` | A PR |
| `/macro-loop:verify` | Judges the PR against the spec in fresh-context subagents and posts PASS or NEEDS-FIX | A PR comment |

A typical run: "What needs attention?" with `triage`, then "grill #12", then `/macro-loop:spec`, then `/macro-loop:implement #12`, which ends with the PR opened and verified.

## Contents

| Path | What |
|---|---|
| `skills/*/SKILL.md` | One skill per stage. |
| `skills/spec/WRITING-RULES.md` | How to write a spec that stays true and can be checked. |
| `skills/init/templates/` | Issue templates and the default config file. |
| `agents/verifier.md` | The fresh-context verifier `verify` runs, one per axis. |
| `reference/github.md` | GitHub REST calls, markers, and which comments are trusted. |
| `reference/workflow.md` | Labels, config, the warn-and-record rule, and what to do without an Issue. |
| `NOTICE.md` | Upstream license and the list of derived files. |

## Design notes

- **The spec is the contract.** `verify` sees only the Issue and the diff, so the spec comment carries testable acceptance criteria and an out-of-scope list, not just decisions.
- **Labels index; comments carry content.** GitHub filters Issues by label but cannot find comments by content. Priority, state, source and skipped stages are labels. The spec and the verdicts are comments found by a hidden marker (`<!-- macro-loop:spec -->`, `<!-- macro-loop:verify round=N -->`), counted only when written by an owner, member or collaborator.
- **REST only.** Claude Code cloud sessions block GitHub GraphQL, which `gh issue` and `gh pr` use. Every GitHub call goes through `gh api`, so the skills work the same locally and in the cloud.
- **Verdict.** NEEDS-FIX when an acceptance criterion is unmet or wrong, or when the diff introduces a test or lint failure. Scope creep, failures already on the base branch, and standards findings are reported, not failed. After two re-verifications, a person decides.
- **Fresh context.** The `verifier` agent has not seen how the change was written, and is told not to manufacture findings.

## Requirements

- A GitHub repository, and the `gh` CLI signed in to it.

## Install

Add the marketplace first (see the [repo README](../../README.md)), then:

```
/plugin install macro-loop@juhyeonni
```

Restart Claude Code after installing.

For local testing:

```bash
claude --plugin-dir ./plugins/macro-loop
```

## Credits

The skills are forked from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) at commit `d81f3a1`. See [NOTICE.md](NOTICE.md) for the license and the list of derived files.
