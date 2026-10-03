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

Read the spec: the newest trusted comment carrying `<!-- macro-loop:spec -->`. Following **Missing inputs** in `workflow.md`, check:

- No priority label on the Issue: `skipped:triage`.
- No spec: `skipped:spec`. Say that `verify` will then judge against the Issue body.

Warn about both in one message and ask once.

If this run follows a NEEDS-FIX verdict, also read the newest trusted verify comment on the PR (marker `<!-- macro-loop:verify round=`). Its Spec findings are the work for this round.

## 2. Branch

Work on the current branch, unless it is the default branch: a PR needs a branch of its own. On the default branch, create `<issue-number>-<short-slug>` and switch to it.

## 3. Build

Use the `tdd` skill where possible, at the seams the spec names, if it is installed. Run the typechecker and single test files regularly, and the full test suite once at the end.

If the work shows that the spec is wrong or incomplete, stop and tell the user what and why. Once they agree, edit the spec comment in place and mark the changed item `(changed: <reason>)`. Never build against a spec you have privately decided to ignore: `verify` judges the diff against the comment as written.

## 4. Commit

Commit your work to the current branch.

## 5. Hand over

Call the Skill tool for `macro-loop:open-pr`, then for `macro-loop:verify`. `open-pr` pushes the branch and opens the PR, or pushes to the PR that already exists. `verify` judges the PR in a fresh context and posts the verdict.
