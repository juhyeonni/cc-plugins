---
name: verify
description: "Verify a pull request against its GitHub Issue's spec in a fresh context and post a PASS / NEEDS-FIX verdict on the PR. Judges two axes, Spec and Standards, in verifier subagents that get identifiers only; asks before running a spec's commands or an untrusted author's tests; stops after two re-verifications. Use when the user asks to verify a PR or a branch, or when implement hands over."
---

# Verify

Judge the change against what its Issue asked for, in a context that did not write it, and post the verdict on the PR.

Two axes, reported side by side:

- **Spec:** does the diff do what the Issue's spec asks? This axis decides the verdict.
- **Standards:** does the code follow this repo's documented standards? Reported, never a reason to fail.

Each axis runs in its own `macro-loop:verifier` subagent. The subagent gets identifiers only and fetches the spec and the diff itself, so nothing from the context that wrote the change, including this one, reaches it.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`. Trust, the Issue, the spec and the round come from one command, run in the repo's checkout: `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --pr <n>` when there is a PR, which finds the Issue from the PR's body itself, else `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --issue <n>`. **Configuration** in `workflow.md` says what it prints.

## 1. Find the PR, the Issue and the spec

- **PR:** the one the user named, else the open PR for the current branch. Without a PR, verify the current branch against the default branch and print the verdict in the terminal instead of posting it.
- **Issue:** `pr.closes` in the trust command's output, from the `Closes #<n>` line in the PR body. Without a PR, the Issue the user named or the branch name points to. If the PR has no such line, say that the PR is not linked to an Issue and ask which Issue it implements, then run the trust command again with `--issue <n>` added. If there is none, follow **No Issue yet** in `workflow.md`. Once the Issue is known, offer to add `Closes #<n>` to the PR body (see `github.md`), so the next round finds it.
- **Spec:** the comment whose id is `issue.spec` in the trust command's output. Without one, follow **Missing inputs** in `workflow.md` (`skipped:spec`). On proceed, judge against the Issue body and say so in the verdict: "no spec; judged against the Issue body".

## 2. Count the round

This run is round N = `pr.round` in the trust command's output: the trusted verify comments on the PR, plus one.

If three or more verdicts exist and the newest is NEEDS-FIX, the cap is reached: say so, and that a person decides what happens next. Run another round only if the user asks for it explicitly.

## 3. Pin the diff

- **Base:** the PR's base branch, else the default branch. Run `git fetch origin <base>`.
- **Head:** the local checkout must match the PR head. Compare `git rev-parse HEAD` with the PR's `.head.sha`. If they differ, read the PR once more, since GitHub can lag a few seconds after a push. If they still differ:
  - The local branch has commits the PR lacks: ask the user to push them first, or run `open-pr`.
  - The PR has commits the local checkout lacks, or verify was started on another branch: offer to check out the PR head (see `github.md`) and continue there.
- **Diff:** stop here if `git diff origin/<base>...HEAD` is empty. The verifiers compute the diff themselves.

## 4. Decide what may run

The verifiers run code on this machine only with the user's go-ahead, and only in their own disposable worktrees, never in this checkout:

- **Spec commands.** When the spec comes from a trusted spec comment, list every `check: cmd` command in it. When the judgment is against an Issue body, no command from it ever runs.
- **Tests and lint.** The repo's tests and lint run at the PR head.

What to ask depends on the PR's author:

- **`pr.authorTrusted` is false:** ask one question for the spec's commands and the tests and lint together. Say that the PR's author is not trusted, and that both run code from this PR: the change under test, and any script a command calls, such as `npm test`. The one answer sets both `Run spec commands` and `Run tests and lint`. An answer that allows only some of them is a no for all of them: say why, and that the verifiers will judge from the diff. This plugin's hook, `scripts/verifier-flags.mjs`, holds to this: a spec verifier started with the two lines set differently for such a PR gets both set to `no`. On no, the verifier judges every criterion from the diff and skips the tests and lint.
- **A trusted author, or no PR:** ask once whether the verifier may run the spec's commands. On no, it judges those criteria from the diff. The tests and lint run either way.

If the user already approved these same commands earlier in this session, for example when `implement` asked, say so and use that answer instead of asking again.

## 5. Identifiers only: start both verifiers

Spawn two `macro-loop:verifier` subagents in one message, each with the Agent tool's `isolation` set to `"worktree"`, so each runs in a disposable worktree of its own, never in this checkout. The verifier's definition declares the same isolation for a call that leaves it out, but only the call's own `isolation` keeps a subagent from starting as a teammate in this checkout where agent teams are on. Each prompt is exactly the lines below, filled in, and nothing else: no notes, no summary of the change, no view on any criterion. The verifier fetches the rest itself.

Spec verifier:

```text
Axis: spec
Issue: #<n>
Spec comment: <id> | none
Base: origin/<base>
Head: <sha of HEAD>
Run spec commands: yes | no
Run tests and lint: yes | no
```

Standards verifier:

```text
Axis: standards
Issue: #<n>
Spec comment: <id> | none
Base: origin/<base>
Head: <sha of HEAD>
```

If something about the change seems worth a verifier's attention, it goes in your own message to the user, never in a verifier's prompt.

Never run a spec's checks yourself, and never offer to: this session may be the one that wrote the change. Only the verifiers' reports decide the verdict.

Claude Code removes a verifier's worktree when it ends without changes, so a verifier continued with `SendMessage` would run in this checkout: never continue a verifier with `SendMessage`. This plugin's hook, `scripts/verifier-worktree.mjs`, refuses any command a verifier would run outside its own worktree.

## 6. Decide the verdict

A verifier of either axis that stops without a report, or whose commands the hook refused, makes the run INCONCLUSIVE: print which axis did not report and why, post nothing, and say what would let it run. The verdict comment needs both reports, and one axis must not hide the other.

From the Spec verifier's report:

- **INCONCLUSIVE** if its **Could not run** list is not empty: a check it was allowed to run did not run at all, or ran without a result anyone can read. This holds even when the diff seems to settle the criterion.
- **NEEDS-FIX** if an acceptance criterion is unmet or implemented wrongly, or if the diff introduces a test or lint failure.
- **PASS** otherwise.

Failures already present on the base branch, behavior outside the spec (scope creep), and Standards findings are reported, not failed. `manual` criteria are listed for a person, not guessed. A criterion judged from the diff because running was declined is not INCONCLUSIVE; the report says how it was judged.

## 7. Report the verdict

**PASS or NEEDS-FIX:** post one comment on the PR. Without a PR, print it, and offer to post it on the Issue as a plain comment, without the marker, so the result is not left in the chat only. The verdict counts as posted only when the POST printed the comment's id (see `github.md`). If it did not, the verdict was not posted: say so, with the error, and print the verdict here.

```markdown
<!-- macro-loop:verify round=N -->
## Verify: PASS | NEEDS-FIX (round N of 3)

**Judged against:** the spec comment on #<n> | no spec; judged against the Issue body

### Spec

<Spec verifier report>

### Standards

<Standards verifier report>

**Manual checks left for a person:** <list, or "none">

**Next:** <from step 8>
```

Keep both reports as the verifiers wrote them, lightly cleaned. Add nothing of your own to them, such as a check this session ran earlier: a gap you see goes in your message to the user, outside the verdict. Don't merge or rerank findings across the axes: a change can follow every standard and still miss the spec, or match the spec and break the conventions, and one axis must not hide the other.

**INCONCLUSIVE:** print what could not run and the error. Post no comment with the marker: an inconclusive run is not a round. Say what would let the checks run, then verify again.

If a verifier's result says its worktree was kept because files changed in it, remove that worktree and its branch: `git worktree remove --force <path>`, then `git branch -D <branch>`.

## 8. Next step

- **PASS:** the PR is ready for a person to review and merge.
- **NEEDS-FIX in round 1 or 2:** run `/macro-loop:implement` to fix the Spec findings; it hands back to verify.
- **NEEDS-FIX in round 3:** stop. Two re-verifications have not converged, and a person decides what happens next.
- **INCONCLUSIVE:** fix what kept the checks from running, then verify again; the round number stays the same.
