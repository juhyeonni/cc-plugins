---
name: implement
description: "Implement the work a GitHub Issue's spec comment describes, commit it, then hand over to open-pr and verify. Use when the user wants an Issue implemented, or the findings of a NEEDS-FIX verdict fixed."
disable-model-invocation: true
---

# Implement

Implement the work the Issue's spec describes, then hand over to `open-pr` and `verify`.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`. Trust, the spec and the last verdict come from one command, run in the repo's checkout: `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs --issue <n>`, plus `--pr <n>` when the current branch has an open PR. **Configuration** in `workflow.md` says what it prints.

## 1. Find the Issue and its spec

Use the Issue the user named, or the one the conversation or the branch name points to. If there is none, follow **No Issue yet** in `workflow.md`.

Read the spec: the comment whose id is `issue.spec` in the trust command's output. Following **Missing inputs** in `workflow.md`, check:

- No priority label on the Issue: `skipped:triage`.
- No spec: `skipped:spec`. Say that `verify` will then judge against the Issue body.

Warn about both in one message and ask once.

If the current branch already has an open PR, read the comment whose id is `pr.lastVerdict`. If that verdict is NEEDS-FIX, its Spec findings are the work for this round.

## 2. Branch

Work on the current branch only when it belongs to this Issue: it is named `<n>-<slug>` for this Issue's number `<n>`, or it holds commits for this Issue alone.

- **On the default branch:** create `<n>-<short-slug>` from it and switch to it. A PR needs a branch of its own.
- **On another Issue's branch** (named `<m>-<slug>` with a different number, or holding another Issue's commits): say so, and offer to create `<n>-<short-slug>` from the default branch (`git fetch origin <default>` then `git switch -c <n>-<short-slug> origin/<default>`). Commit to the other branch only if the user says the two belong together.

Never check out a branch to work on it unless you created it. If an open PR for another branch already closes this Issue, say so and ask the user what to do.

If uncommitted changes are in the way of a switch, stop and ask the user what to do with them. Never stash, discard or carry them along on your own: they may belong to other work. If the user asks you to stash them, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/stash.mjs save --issue <n>` and keep the `entry` hash it prints: step 5 puts the changes back with it. Never stash, apply or drop with `git stash` yourself: the stash is shared by every worktree of the repo, and the script finds this entry by its hash.

## 3. Build

Before running any `check: cmd` command from the spec, list them and ask once, as `verify` does: someone else may have written the spec. Never run a command taken from an Issue body. The repo's own tests and typechecker need no question on a branch you made from the default branch. On any other branch, ask before running them: someone else may have written them.

Use the `tdd` skill where possible, at the seams the spec names, if it is installed. When a bug's cause is unclear, use the `diagnosing-bugs` skill if it is installed. Run the typechecker and single test files regularly, and the full test suite once at the end.

If the work shows that the spec is wrong or incomplete, stop and tell the user what and why. Once they agree, edit the spec comment in place and mark the changed item `(changed: <reason>)`. Never build against a spec you have privately decided to ignore: `verify` judges the diff against the comment as written.

## 4. Commit

Commit your work to the current branch.

## 5. Put back the user's changes

If step 2 stashed the user's changes, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/stash.mjs restore --entry <entry>` with the hash `save` printed. It switches back to the branch the changes came from, applies them only where they cannot conflict, and only then drops the entry. If it fails, tell the user the changes are still in the stash, with the script's error, which says how to apply them by hand, and stop. Never drop, apply, restore or check out anything yourself to get past it.

## 6. Hand over

Call the Skill tool for `macro-loop:open-pr`, then for `macro-loop:verify`, each with the branch name: the branch you committed to in step 4, whatever is checked out now. A skill does not run by itself: the Skill tool loads its steps into this turn. Carry out each skill's steps to the end before calling the next one. `open-pr` pushes the branch and opens the PR, or pushes to the PR that already exists. `verify` judges the PR in a fresh context and posts the verdict.

If the user declines the push or the PR, still call `macro-loop:verify` with the branch name and carry out its steps: it judges that branch against the default branch without a PR. Never say that verify needs a PR.
