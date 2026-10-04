---
name: implement
description: "Implement the work a GitHub Issue's spec comment describes, commit it, then hand over to open-pr and verify. Use when the user wants an Issue implemented, or the findings of a NEEDS-FIX verdict fixed."
disable-model-invocation: true
---

# Implement

Implement the work the Issue's spec describes, then hand over to `open-pr` and `verify`.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`. Trust, the spec and the last verdict come from one command, run in the repo's checkout: `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --issue <n>`, plus `--pr <n>` when the branch you work on (step 2) has an open PR. **Configuration** in `workflow.md` says what it prints.

## 1. Find the Issue and its spec

Use the Issue the user named, or the one the conversation or the branch name points to. If there is none, follow **No Issue yet** in `workflow.md`.

Read the spec: the comment whose id is `issue.spec` in the trust command's output. Following **Missing inputs** in `workflow.md`, check:

- No priority label on the Issue: `skipped:triage`.
- No spec: `skipped:spec`. Say that `verify` will then judge against the Issue body.

Warn about both in one message and ask once.

If the branch you will work on (step 2) has an open PR, read the comment whose id is `pr.lastVerdict`. If that verdict is NEEDS-FIX, its Spec findings are the work for this round.

## 2. Branch

A branch the user named, for example the one `verify` named after a NEEDS-FIX verdict, is the branch to work on. With no branch named, work on the current branch only when it belongs to this Issue: it is named `<n>-<slug>` for this Issue's number `<n>`, or it holds commits for this Issue alone.

- **On the default branch:** make `<n>-<short-slug>`. A PR needs a branch of its own.
- **On another Issue's branch** (named `<m>-<slug>` with a different number, or holding another Issue's commits): say so, and offer to make `<n>-<short-slug>`. Commit to the other branch only if the user says the two belong together.

Never check out a branch to work on it unless you created it or the user named it. If an open PR for another branch already closes this Issue, say so and ask the user what to do.

When the branch to work on is the one checked out in the user's checkout, work in place.

When you do not work in place, never switch the user's checkout, and change nothing in it, before or after the worktree: no edit, no test run, no stash. Work in a worktree of your own, in this order:

1. If `EnterWorktree` and `ExitWorktree` are listed by name only, they cannot be called yet: load both with the ToolSearch tool, query `select:EnterWorktree,ExitWorktree`.
2. Enter the worktree with the `EnterWorktree` tool, named `<n>-<short-slug>`.
3. In it, run `git fetch origin <default>`. Then run `git switch -c <n>-<short-slug> origin/<default>` for a new branch, or `git switch <branch>` for a branch that already exists.
4. Run `git branch -D worktree-<n>-<short-slug>` to delete the branch the worktree started on.

Build, commit and hand over from the worktree.

Uncommitted changes in the user's checkout are not in the way of a worktree. Never stash, discard or carry them along: they may belong to other work.

## 3. Build

Before running any `check: cmd` command from the spec, list them and ask once, as `verify` does: someone else may have written the spec. Never run a command taken from an Issue body. The repo's own tests and typechecker need no question on a branch you made from the default branch. On any other branch, ask before running them: someone else may have written them.

Use the `tdd` skill where possible, at the seams the spec names, if it is installed. When a bug's cause is unclear, use the `diagnosing-bugs` skill if it is installed. Run the typechecker and single test files regularly, and the full test suite once at the end.

If the work shows that the spec is wrong or incomplete, stop and tell the user what and why. Once they agree, edit the spec comment in place and mark the changed item `(changed: <reason>)`. Never build against a spec you have privately decided to ignore: `verify` judges the diff against the comment as written.

## 4. Commit

Commit your work to the current branch.

## 5. Hand over

Call the Skill tool for `macro-loop:open-pr`, then for `macro-loop:verify`, each with the branch name: the branch you committed to in step 4. A skill does not run by itself: the Skill tool loads its steps into this turn. Carry out each skill's steps to the end before calling the next one. `open-pr` pushes the branch and opens the PR, or pushes to the PR that already exists. `verify` judges the PR in a fresh context and posts the verdict.

If the user declines the push or the PR, still call `macro-loop:verify` with the branch name and carry out its steps: it judges that branch against the default branch without a PR. Never say that verify needs a PR.

On either path, stay in the worktree until verify has posted or printed its verdict. Then leave it with the `ExitWorktree` tool, `action: "keep"`, and remove it with `git worktree remove <path>`, the path `EnterWorktree` printed. The branch and its commits stay. Tell the user the branch's name, and that it stays in the repo, checked out nowhere. If you worked in place, there is no worktree to leave.
