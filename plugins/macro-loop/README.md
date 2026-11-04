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
| `/macro-loop:status` | Shows every open Issue and PR with its stage, what a person does next, and one recommended step | Nothing (read-only) |
| `/macro-loop:next` | Takes one Issue through the stages in order, calling each skill, and stops where a person has to act | What each stage leaves behind |
| `/macro-loop:triage` | Proposes a priority, a state and a source for each Issue, and applies them after approval. Given a request in plain words instead of an Issue number, it opens the Issue, already triaged | Labels, and new Issues |
| `/macro-loop:grilling` | Interviews you until every decision is settled | Decisions in the conversation |
| `/macro-loop:research` | Finds references and prior art with the web tools the session has, stops when its key questions are answered with sources, and leaves a comment that names the tools used and each source. `grilling` calls it for its researchable questions; it is not a stage | An Issue comment with findings, sources, Gaps and the tools used |
| `/macro-loop:ui-placement` | Chooses where a visible change goes before it is built: reads the real screen, finds the components to reuse, shows at least two options, and returns the chosen one. `grilling` calls it when `uiKit` is set; it is not a stage | The `UI: yes` and `Placement:` lines for the spec |
| `/macro-loop:spec` | Writes the spec: goal, decisions with reasons, testable acceptance criteria, out of scope | A pinned Issue comment |
| `/macro-loop:implement` | Builds what the spec asks for, commits, and hands over to `open-pr` and `verify` | Commits |
| `/macro-loop:open-pr` | Pushes the branch and opens a draft PR with `Closes #n`, asking first unless you asked for the push | A draft PR |
| `/macro-loop:verify` | Judges the PR against the spec in fresh-context subagents and posts PASS or NEEDS-FIX, with Claude Code's `/security-review` findings listed first | A PR comment |
| `/macro-loop:execute` | Takes one or more Issues that are ready for implement, open-pr or verify, asks every question first, then implements, opens draft PRs and verifies them in parallel, and reports one row per Issue | Commits, draft PRs and PR comments |
| `/macro-loop:goal` | Interviews you about a goal only, then carries the resulting Issues through every stage without asking for implementation details, and stops at the merge | A tracking Issue, child Issues, draft PRs and a summary comment |

A typical run: `/macro-loop:triage What needs attention?`, then `/macro-loop:grilling #12`, then `/macro-loop:spec #12`, then `/macro-loop:implement #12`, which ends with a draft PR opened and verified. `open-pr` asks before it pushes, unless you asked for the push yourself. A draft cannot be merged until you mark it "Ready for review", after reading the verdict.

`/macro-loop:next #12` runs those stages for you in order, and `/macro-loop:execute 12 15 18` runs the machine stages for several Issues at once. NEEDS-FIX is reported, never fixed automatically.

`init`, `next`, `goal` and `execute` start only from their slash command. The other skills also start from plain words, or when another skill hands over to them.

## Contents

| Path | What |
|---|---|
| `skills/*/SKILL.md` | One skill per stage. |
| `skills/spec/WRITING-RULES.md` | How to write a spec that stays true and can be checked. |
| `skills/init/templates/` | Issue templates and the default config file. |
| `agents/verifier.md` | The fresh-context verifier `verify` runs, one per axis. |
| `agents/security-reviewer.md` | Runs Claude Code's bundled `/security-review` on the PR's diff, once per PR, for `verify` and `execute`. |
| `scripts/trust.mjs` | Decides trust in code: the config on the default branch, the trusted logins, an Issue's spec, and a PR's author, last verdict and round. |
| `scripts/verdict.mjs` | Decides the verdict and writes the comment `verify` and `execute` post, from the verifiers' reports. |
| `scripts/execute.mjs` | Picks the Issues `execute` runs and the stage each starts at, and renders its report. |
| `workflows/execute-run.js` | The saved workflow `execute` runs: implement, open-pr and verify for each Issue, at its own pace. It posts no verdict. |
| `hooks/hooks.json` | Holds the verifiers and the security reviewer to their rules with `scripts/verifier-flags.mjs` (Agent calls), `scripts/verifier-worktree.mjs` (Bash calls) and `scripts/verifier-report.mjs` and `scripts/verifier-cleanup.mjs` (a verifier's stop); each script's header says what it does. Every other call passes through unchanged. |
| `reference/github.md` | GitHub REST calls, markers, and which comments are trusted. |
| `reference/workflow.md` | Labels, config, the warn-and-record rule, and what to do without an Issue. |
| `reference/core.md` | The rules every skill reads first: REST only, bodies through a file, when a post counts, trust and what `trust.mjs` prints, untrusted text. |
| `NOTICE.md` | Upstream license and the list of derived files. |
| `skills/open-pr/CREDITS.md` | Where the PR body template comes from. |

## Design notes

- **The spec is the contract.** `verify` sees only the Issue and the diff, so the spec comment carries testable acceptance criteria and an out-of-scope list, not just decisions.
- **Labels index; comments carry content.** GitHub filters Issues by label but cannot find comments by content. Priority, state, source and skipped stages are labels. The spec and the verdicts are comments that start with a hidden marker (`<!-- macro-loop:spec -->`, `<!-- macro-loop:verify round=N -->`), counted only when written by a trusted author (see `reference/github.md`).
- **REST only.** Claude Code cloud sessions block GitHub GraphQL, which `gh issue` and `gh pr` use. Every GitHub call goes through `gh api`, so the skills work the same locally and in the cloud.
- **Verdict.** NEEDS-FIX when an acceptance criterion is unmet or wrong, or the diff introduces a test or lint failure; everything else is reported, not failed. Security findings are reported first and never fail a PR. After two re-verifications, a person decides.
- **Outside tools, unchanged.** `verify` runs Claude Code's bundled `/security-review` as it ships, so its updates reach you. It only diffs against `origin/HEAD`, so a PR based on another branch gets a verdict that says Security did not run.
- **Fresh context, same model.** The `verifier` runs on the session's model in a fresh context that has not seen how the change was written, and is told not to manufacture findings.
- **Running code.** Each verifier runs in a disposable worktree of its own, never in your checkout, and `verify` asks before it runs a spec's commands, or an untrusted author's tests. No command from an Issue body ever runs.
- **Read-only before implement.** `triage`, `grilling`, `research`, `ui-placement` and `spec` never change the working tree or run the repo's code in it. Code they need to see run goes to a subagent in a disposable worktree.
- **Enforced, or followed.** Claude Code enforces two things: the verifier's worktree, which its definition declares, and the permission prompts for commands. Who is trusted, which comment is the spec or a verdict, and the verdict itself are decided in code (`scripts/trust.mjs`, `scripts/verdict.mjs`), the same way on every run, and the plugin's hooks hold the verifiers to their rules (see `hooks/hooks.json`). Every other rule here is an instruction the model follows. Re-tests found those rules followed on Opus, which is evidence, not a guarantee; on Haiku they were often skipped.

## Recommended

Install the `security-guidance` plugin as well. It checks code for security problems while it is written, before `verify`'s review of the finished diff. Put any security rules of your own in that plugin's settings file, not in macro-loop.

## Requirements

- A GitHub repository, and the `gh` CLI signed in to it.
- Node 22 or later, for the scripts in `scripts/` and the hooks.

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
