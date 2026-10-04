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
| `/macro-loop:init` | Optional setup: labels, bug and feature Issue templates, `.github/macro-loop.json` | Labels and files |
| `/macro-loop:triage` | Proposes a priority, a state and a source for each Issue, and applies them after approval | Labels |
| `/macro-loop:grilling` | Interviews you until every decision is settled | Decisions in the conversation |
| `/macro-loop:spec` | Writes the spec: goal, decisions with reasons, testable acceptance criteria, out of scope | A pinned Issue comment |
| `/macro-loop:implement` | Builds what the spec asks for, commits, and hands over to `open-pr` and `verify` | Commits |
| `/macro-loop:open-pr` | Pushes the branch and opens the PR with `Closes #n` | A PR |
| `/macro-loop:verify` | Judges the PR against the spec in fresh-context subagents and posts PASS or NEEDS-FIX | A PR comment |

A typical run: `/macro-loop:triage What needs attention?`, then `/macro-loop:grilling #12`, then `/macro-loop:spec #12`, then `/macro-loop:implement #12`, which ends with the PR opened and verified.

`triage`, `spec`, `implement` and `init` start only from their slash command, so typing "What needs attention?" on its own does not run triage. `grilling`, `open-pr` and `verify` also start from plain words, or when another skill hands over to them.

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
- **Labels index; comments carry content.** GitHub filters Issues by label but cannot find comments by content. Priority, state, source and skipped stages are labels. The spec and the verdicts are comments that start with a hidden marker (`<!-- macro-loop:spec -->`, `<!-- macro-loop:verify round=N -->`), counted only when written by a trusted author: you, the logins listed in `.github/macro-loop.json`, or, without a list, the owner of a repo owned by a person.
- **REST only.** Claude Code cloud sessions block GitHub GraphQL, which `gh issue` and `gh pr` use. Every GitHub call goes through `gh api`, so the skills work the same locally and in the cloud.
- **Verdict.** NEEDS-FIX when an acceptance criterion is unmet or wrong, or when the diff introduces a test or lint failure. Scope creep, failures already on the base branch, and standards findings are reported, not failed. After two re-verifications, a person decides. When a check the verifier was allowed to run cannot run at all, the run is INCONCLUSIVE: nothing is posted and it does not count as a round.
- **Fresh context, same model.** The `verifier` agent runs on the same model as the session, in a fresh context: it has not seen how the change was written, gets identifiers only, fetches the spec and the diff itself, and is told not to manufacture findings.
- **Running code.** `verify` asks before the verifier runs a spec's `check: cmd` commands, and before it runs the tests of a PR whose author is not trusted. It never runs a command found in an Issue body.
- **Read-only before implement.** `triage`, `grilling` and `spec` never change the working tree; anything that writes runs in a temporary worktree.

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
