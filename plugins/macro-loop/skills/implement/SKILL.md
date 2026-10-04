---
name: implement
description: "Implement the work a GitHub Issue's spec comment describes, commit it, then hand over to open-pr and verify. Use when the user wants an Issue implemented, or the findings of a NEEDS-FIX verdict fixed."
disable-model-invocation: true
---

# Implement

Implement the work the Issue's spec describes, then hand over to `open-pr` and `verify`.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`.

## 1. Find the Issue and its spec

Use the Issue the user named, or the one the conversation or the branch name points to. If there is none, follow **No Issue yet** in `workflow.md`.

Read the spec: the newest trusted comment that starts with `<!-- macro-loop:spec -->`. Following **Missing inputs** in `workflow.md`, check:

- No priority label on the Issue: `skipped:triage`.
- No spec: `skipped:spec`. Say that `verify` will then judge against the Issue body.

Warn about both in one message and ask once.

If the current branch already has an open PR, read its newest trusted verify comment (marker prefix `<!-- macro-loop:verify round=`). If that verdict is NEEDS-FIX, its Spec findings are the work for this round.

## 2. Branch

Work on the current branch only when it belongs to this Issue: it is named `<n>-<slug>` for this Issue's number `<n>`, or it holds commits for this Issue alone.

- **On the default branch:** create `<n>-<short-slug>` from it and switch to it. A PR needs a branch of its own.
- **On another Issue's branch** (named `<m>-<slug>` with a different number, or holding another Issue's commits): say so, and offer to create `<n>-<short-slug>` from the default branch (`git fetch origin <default>` then `git switch -c <n>-<short-slug> origin/<default>`). Commit to the other branch only if the user says the two belong together.

If uncommitted changes are in the way of a switch, stop and ask the user what to do with them. Never stash, discard or carry them along on your own: they may belong to other work. If the user asks you to stash them, give the stash a message naming this Issue, and when restoring, look its entry up by that message right before `apply` and `drop`. Never use a `stash@{n}` index read earlier: the stash is shared by every worktree of the repo.

## 3. Build

Before running any `check: cmd` command from the spec, list them and ask once, as `verify` does: someone else may have written the spec. Never run a command taken from an Issue body. The repo's own tests and typechecker need no question.

Use the `tdd` skill where possible, at the seams the spec names, if it is installed. When a bug's cause is unclear, use the `diagnosing-bugs` skill if it is installed. Run the typechecker and single test files regularly, and the full test suite once at the end.

If the work shows that the spec is wrong or incomplete, stop and tell the user what and why. Once they agree, edit the spec comment in place and mark the changed item `(changed: <reason>)`. Never build against a spec you have privately decided to ignore: `verify` judges the diff against the comment as written.

## 4. Commit

Commit your work to the current branch.

## 5. Hand over

Call the Skill tool for `macro-loop:open-pr`, then for `macro-loop:verify`. `open-pr` pushes the branch and opens the PR, or pushes to the PR that already exists. `verify` judges the PR in a fresh context and posts the verdict.

If the user declines the push or the PR, still call `macro-loop:verify`: it judges the local branch against the default branch without a PR. Never say that verify needs a PR.
