---
name: init
description: "Set up a GitHub repo for the macro-loop skills: create the labels, add bug and feature Issue templates, and write .claude/macro-loop.json, each only after approval. Optional; the other skills work with the defaults without it."
disable-model-invocation: true
---

# Init

Set up the repo so the other skills have their labels, Issue templates and config. This is optional: without it the skills use the default labels, and a missing label is created the first time a skill adds it to an Issue.

This is a prompt-driven setup, not a script. Explore, present what you found, confirm with the user, then write.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`.

## 1. Explore

Look at the repo's starting state; don't assume:

- `git remote -v`: is this a GitHub repo, and which one?
- The repo's existing labels (see `github.md`).
- `.github/ISSUE_TEMPLATE/`: which templates exist?
- `.claude/macro-loop.json`: does it exist, and which labels does it rename?

## 2. Present and ask, one section at a time

Summarise what is present and what is missing. Then take the sections in order, one answer each. Lead each with the recommended answer so the user can accept it in a word, and skip a section that exploration already settled.

**A. Labels.** Create the labels from `workflow.md` that the repo lacks, with these colors and each label's meaning from `workflow.md` as its description. Leave existing labels alone.

| Labels | Color |
|---|---|
| `P0` | `b60205` |
| `P1` | `d93f0b` |
| `P2` | `fbca04` |
| `ready-for-agent` | `0e8a16` |
| `needs-info` | `d876e3` |
| `needs-decision` | `1d76db` |
| `wontfix` | `ffffff` |
| `source:*` | `c5def5` |
| `skipped:*` | `ededed` |

When the config file renames a label, create the renamed label with the color of the default it replaces.

**B. Issue templates.** Add [bug.yml](templates/bug.yml) and [feature.yml](templates/feature.yml) to `.github/ISSUE_TEMPLATE/`. Their "How was this opened?" question is what `triage` reads to pick the source label. If templates with these names exist, show the difference and ask.

**C. Config file.** Write [macro-loop.json](templates/macro-loop.json) to `.claude/macro-loop.json`. Recommend the defaults, unless the repo already uses other names for the same roles (for example `priority:high` for `P1`). Then map those names in the file, so the skills use the existing labels instead of creating duplicates.

## 3. Confirm and write

Show what each approved section will do: the labels to create and the files to write. Then:

- Create the labels with REST (see `github.md`).
- Write the files.
- Ask whether to commit the files; if yes, commit them to the current branch.

## 4. Done

Say what was set up, and that the templates and `.claude/macro-loop.json` can be edited directly later. Re-running this skill is only needed to add what is still missing.
