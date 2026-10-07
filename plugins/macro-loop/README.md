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
| `/macro-loop:spec` | Writes the spec: goal, decisions with reasons, testable acceptance criteria, out of scope | A pinned Issue comment |
| `/macro-loop:implement` | Builds what the spec asks for, commits, and hands over to `open-pr` and `verify` | Commits |
| `/macro-loop:open-pr` | Pushes the branch and opens a draft PR with `Closes #n`, asking first unless you asked for the push | A draft PR |
| `/macro-loop:verify` | Judges the PR against the spec in fresh-context subagents and posts PASS or NEEDS-FIX | A PR comment |
| `/macro-loop:execute` | Takes one or more Issues that are ready for implement, open-pr or verify, asks every question first, then implements, opens draft PRs and verifies them in parallel, and reports one row per Issue | Commits, draft PRs and PR comments |

A typical run: `/macro-loop:triage What needs attention?`, then `/macro-loop:grilling #12`, then `/macro-loop:spec #12`, then `/macro-loop:implement #12`, which ends with a draft PR opened and verified. `open-pr` asks before it pushes, unless you asked for the push yourself. A draft cannot be merged until you mark it "Ready for review", after reading the verdict.

`/macro-loop:next #12` runs those stages for you in order and stops where a person has to act: an interview, an answer from the requester, the merge.

`/macro-loop:execute 12 15 18` does the machine stages for several Issues at once. Before anything starts, it asks which spec commands may run and whether to push; then it carries them all through implement, open-pr and verify in one workflow run, each Issue at its own pace, and stops before the merge. NEEDS-FIX is reported, never fixed automatically.

`init`, `next` and `execute` start only from their slash command. The other skills also start from plain words, or when another skill hands over to them.

## Contents

| Path | What |
|---|---|
| `skills/*/SKILL.md` | One skill per stage. |
| `skills/spec/WRITING-RULES.md` | How to write a spec that stays true and can be checked. |
| `skills/init/templates/` | Issue templates and the default config file. |
| `agents/verifier.md` | The fresh-context verifier `verify` runs, one per axis. |
| `scripts/trust.mjs` | Decides trust in code: the config on the default branch, the trusted logins, an Issue's spec, and a PR's author, last verdict and round. |
| `scripts/execute.mjs` | Picks the Issues `execute` runs and the stage each starts at, from `stage.mjs`, and renders its report. Leaves out an Issue whose PR author is not trusted. |
| `workflows/execute-run.js` | The saved workflow `execute` runs by name, once for all its Issues, each at its own pace. Its phases are `implement` (in a worktree of its own), `open-pr` (with the push approval `execute` passed in) and `verify` (two verifiers started with the identifier lines only). It posts no verdict. |
| `hooks/hooks.json` | Runs `scripts/verifier-flags.mjs` before every Agent call and `scripts/verifier-worktree.mjs` before every Bash call. The first changes only a spec verifier that `verify` starts for a PR whose author is not trusted; the second refuses only a verifier's command outside its own worktree (`agent-<id>`, or the `wf_*` worktree a workflow made for it). When a verifier stops, it runs `scripts/verifier-cleanup.mjs`, which removes the verifier's worktree and branch (`agent-<id>`, or a workflow's `wf_*`), but keeps a branch that holds a commit on no remote branch. Every other call passes through unchanged. |
| `reference/github.md` | GitHub REST calls, markers, and which comments are trusted. |
| `reference/workflow.md` | Labels, config, the warn-and-record rule, and what to do without an Issue. |
| `NOTICE.md` | Upstream license and the list of derived files. |
| `skills/open-pr/CREDITS.md` | Where the PR body template comes from. |

## Design notes

- **The spec is the contract.** `verify` sees only the Issue and the diff, so the spec comment carries testable acceptance criteria and an out-of-scope list, not just decisions.
- **Labels index; comments carry content.** GitHub filters Issues by label but cannot find comments by content. Priority, state, source and skipped stages are labels. The spec and the verdicts are comments that start with a hidden marker (`<!-- macro-loop:spec -->`, `<!-- macro-loop:verify round=N -->`), counted only when written by a trusted author: you, the logins listed in `.github/macro-loop.json` on the default branch, or, without a list, the owner of a repo owned by a person.
- **REST only.** Claude Code cloud sessions block GitHub GraphQL, which `gh issue` and `gh pr` use. Every GitHub call goes through `gh api`, so the skills work the same locally and in the cloud.
- **Verdict.** NEEDS-FIX when an acceptance criterion is unmet or wrong, or when the diff introduces a test or lint failure. Scope creep, failures already on the base branch, and standards findings are reported, not failed. After two re-verifications, a person decides. When a check the verifier was allowed to run cannot run at all, the run is INCONCLUSIVE: nothing is posted and it does not count as a round.
- **Fresh context, same model.** The `verifier` agent runs on the same model as the session, in a fresh context: it has not seen how the change was written, gets identifiers only, fetches the spec and the diff itself, and is told not to manufacture findings.
- **Running code.** Each verifier runs in a disposable worktree of its own, never in your checkout. `verify` asks before the verifier runs a spec's `check: cmd` commands. When the PR's author is not trusted, it asks one question for the spec's commands and the tests together, since both run code from this PR. It never runs a command found in an Issue body.
- **Read-only before implement.** `triage`, `grilling` and `spec` never change the working tree or run the repo's code in it. Code they need to see run goes to a subagent in a disposable worktree.
- **Enforced, or followed.** Claude Code enforces two things: the verifier's worktree, which its definition declares, and the permission prompts for commands. Who is trusted, and which comment is the spec or a verdict, is decided by `scripts/trust.mjs`, the same way on every run. For a PR whose author is not trusted, the plugin's hook, `scripts/verifier-flags.mjs`, gives the spec's commands and the tests the same answer. Claude Code gives a verifier its worktree only when the verifier starts, so a second hook, `scripts/verifier-worktree.mjs`, refuses any command a verifier would run outside it, such as after `verify` continued a stopped verifier. Claude Code can leave a verifier's worktree and branch behind, so a third hook, `scripts/verifier-cleanup.mjs`, removes both when a verifier stops, in the foreground or the background, but keeps a branch that holds a commit on no remote branch and says so. Every other rule here is an instruction the model follows. Re-tests found those rules followed on Opus, which is evidence, not a guarantee; on Haiku they were often skipped.

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
