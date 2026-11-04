---
name: verify
description: "Verify a pull request against its GitHub Issue's spec in a fresh context and post a PASS / NEEDS-FIX verdict on the PR. Judges two axes, Spec and Standards, in verifier subagents that get identifiers only; asks before running a spec's commands or an untrusted author's tests; stops after two re-verifications. Use when the user asks to verify a PR or a branch, or when implement hands over."
---

# Verify

Judge the change against what its Issue asked for, in a context that did not write it, and post the verdict on the PR.

Two axes, reported side by side:

- **Spec:** does the diff do what the Issue's spec asks? This axis decides the verdict.
- **Standards:** does the code follow this repo's documented standards? Reported, never a reason to fail.

Each axis runs in its own `macro-loop:verifier` subagent (step 5).

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/core.md`. Trust, the Issue, the spec and the round come from one command, run in the repo's checkout: `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --pr <n>` when there is a PR, which finds the Issue from the PR's body itself, else `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --issue <n>`. **Trust and trust.mjs** in `core.md` says what it prints.

## 1. Find the branch, the PR, the Issue and the spec

- **Branch:** judge the branch given by name, by the user or by `implement`. With no branch named, use the current branch, resolved to its name with `git branch --show-current` first, so no step refers to `HEAD`.
- **PR:** the one the user named, else the open PR for the branch. Without a PR, verify the branch against the default branch and print the verdict in the terminal instead of posting it.
- **Issues:** `pr.closesAll` in the trust command's output, from the `Closes #<n>` lines in the PR body; one PR can close several. Steps 1 and 5 run for each Issue, and the other steps once for the PR. Without a PR, the Issue the user named or the branch name points to. If the PR has no such line, say that the PR is not linked to an Issue and ask which Issue it implements, then run the trust command again with `--issue <n>` added. If there is none, follow **No Issue yet** in `workflow.md`. Once the Issue is known, offer to add `Closes #<n>` to the PR body (see `github.md`), so the next round finds it.
- **Spec:** the comment whose id is `issue.spec` in the trust command's output (for a PR that closes several Issues, run the command with `--issue <n>` for each of the others). Without one, follow **Missing inputs** in `workflow.md` (`skipped:spec`). On proceed, judge against the Issue body and say so in the verdict: "no spec; judged against the Issue body".

## 2. Count the round

This run is round N = `pr.round` in the trust command's output: the trusted verify comments on the PR, plus one.

If three or more verdicts exist and the newest is NEEDS-FIX, the cap is reached: say so, and that a person decides what happens next. Run another round only if the user asks for it explicitly.

## 3. Pin the diff

- **Base:** the PR's base branch, else the default branch. Run `git fetch origin <base>`.
- **Head:** the branch must match the PR head. Compare `git rev-parse <branch>` with the PR's `.head.sha`. If they differ, read the PR once more, since GitHub can lag a few seconds after a push. If they still differ:
  - The branch has commits the PR lacks: ask the user to push them first, or run `open-pr` with the branch name.
  - The PR has commits the branch lacks, or the PR is for another branch: offer to judge the PR head instead. On yes, fetch it into the local branch `pr-<n>` without switching to it (see `github.md`), and judge `pr-<n>` by name from here on.
- **Diff:** stop here if `git diff origin/<base>...<branch>` is empty. The verifiers compute the diff themselves.

Never switch or check out a branch in the user's checkout: the verifiers fetch the head by sha in worktrees of their own.

## 4. Decide what may run

List the `check: cmd` commands of a trusted spec comment and note its `updated_at` (`gh api repos/{owner}/{repo}/issues/comments/<id> --jq .updated_at`); no command from an Issue body ever runs.

- **`pr.authorTrusted` is false:** ask one question for the spec's commands and the tests and lint together: the author is not trusted, and both run this PR's code, such as `npm test`. The answer sets `Run spec commands` and `Run tests and lint` together; a partial yes is a no (`verifier-flags.mjs` holds to it), and the verifiers judge from the diff.
- **Trusted author, or no PR:** ask once whether the verifier may run the spec's commands; on no, they are judged from the diff. Tests and lint run either way.

An approval of the same commands earlier in this session, such as `implement`'s, holds while `updated_at` is unchanged: say so. Read `updated_at` again just before step 5; if it changed, show the new list and ask.

## 5. Identifiers only: start both verifiers

Spawn both `macro-loop:verifier` subagents in one message, each Agent call with `isolation: "worktree"`: only that keeps one out of this checkout when agent teams are on. Each prompt is exactly these lines:

```text
Axis: spec
Issue: #<n>
Spec comment: <id> | none
Also closes: #<m>, #<k> | none
Base: origin/<base>
Head: <sha of the branch>
Run spec commands: yes | no
Run tests and lint: yes | no
```

```text
Axis: standards
Issue: #<n>
Spec comment: <id> | none
Base: origin/<base>
Head: <sha of the branch>
```

`Also closes` is the rest of `pr.closesAll`, or `none`. Anything else goes to the user, never in a prompt: `verifier-flags.mjs` refuses other lines; start again with the lines alone.

Never run a spec's checks yourself, or offer to. Never continue a verifier with `SendMessage`: its worktree is gone, and `verifier-worktree.mjs` refuses its commands.

## 6. Decide the verdict

A script decides the verdict and writes the comment from the data block each verifier's report ends with, so the session that wrote the change never writes what a person reads first.

The hook `scripts/verifier-report.mjs` saves each verifier's report when it stops. Never write a report to a file yourself. Once every verifier has finished, run, in the repo's checkout and as a Bash call of its own with nothing added, one `--agent` per verifier: the agent id the Agent tool returned for it, spec and standards of every Issue:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/verdict.mjs --round <N> --head <Head from step 5> --branch <branch> --agent <id> --agent <id>...
```

It writes the comment to a file beside the saved reports and prints that file's path and the heading.

It decides each Issue on its own: INCONCLUSIVE when a report or its block is missing or invalid, or `couldNotRun` is not empty, even when the diff seems to settle the criterion; NEEDS-FIX when a criterion is unmet or wrong or the diff introduces a failure; else PASS. The PR is NEEDS-FIX if any Issue is. A criterion judged from the diff because running was declined is not INCONCLUSIVE. Never decide the verdict yourself.

## 7. Report the verdict

**PASS or NEEDS-FIX** (the script exited 0): post the file the script printed as the comment's body, unchanged, with `-F body=@<file>` (see `github.md`). Add nothing, cut nothing, and never write the comment by hand: a gap you see goes in your message to the user, outside the verdict. Without a PR, read the file and show it, and offer to post it on the Issue as a plain comment without its first line, the marker, so the result is not left in the chat only. The verdict counts as posted only when the POST printed the comment's id. If it did not, the verdict was not posted: say so, with the error, and show the verdict here.

The comment starts with the marker `<!-- macro-loop:verify round=N sha=<head> -->` and the heading `## Verify: PASS | NEEDS-FIX (round N of 3)`, which `scripts/trust.mjs` reads; the rest is the script's (see `scripts/verdict.mjs`).

**INCONCLUSIVE** (the script exited non-zero): print what it named and the error. Post no comment with the marker: an inconclusive run is not a round. Say what would let the checks run, then verify again.

## 8. Next step

- **PASS:** the PR is ready for a person: read the verdict, mark the draft "Ready for review", then merge.
- **NEEDS-FIX in round 1 or 2:** tell the person to run `/macro-loop:implement <branch>`, with this branch's name, to fix the Spec findings; it hands back to verify. You never start it yourself: verify changes nothing in the checkout.
- **NEEDS-FIX in round 3:** stop. Two re-verifications have not converged, and a person decides what happens next.
- **Standards findings** (`S1`, `S2`…, on PASS too): say a person can answer each as wrong, intended or minor, in the format under **Markers and trust** in `github.md`. An answer never changes the verdict.
- **INCONCLUSIVE:** fix what kept the checks from running, then verify again; the round number stays the same.
