---
name: ui-placement
description: Choose where a change to what a person sees goes, before it is built: read the real screen, find the components to reuse, show at least two placement options, and return the chosen one. Use when an Issue changes visible UI, or when grilling reaches a question about how something looks.
---

Choose where a visible change goes before `implement` builds it, and hand the choice to the spec. `grilling` calls this skill when the person says an Issue changes what a person sees, or when a question is about how something looks. It also runs on its own with an Issue number.

This skill is not a stage. The Issue still goes from triage to merge in the same order; this is how `grilling` settles the one decision a screen needs.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`.

The working tree is read-only, as in `grilling`: find facts by reading files, `git log` and `git show origin/<default>:<path>`. Never run the app, a browser or the repo's own code in the checkout. To see code run, follow **Working tree before implement** in `workflow.md`.

## 1. Read the real screen first

Find the component that hosts the view and the widths it is shown at, from the default branch. A view can open in more than one place, such as a page and a resizable side panel, each at a different width. State the host and the widths before you draw anything.

When you cannot tell which component hosts the view or how wide it is, ask for a screenshot or the live screen. Do not guess the layout from the code: a proposal drawn from a guessed layout is where the earlier rounds went wrong.

## 2. Find what to reuse

For each new control, find the shared component that already exists and the pattern neighbouring screens use for the same kind of field, such as where its label sits and how it is spaced. Name them. The options below reuse them instead of inventing a new look.

## 3. Show at least two options

A question about how something looks is hard to answer from words, so show the options instead of describing them:

- **Structure only**, such as what goes where or what is shown: give each option an ASCII wireframe in an `AskUserQuestion` `preview`.
- **Look and feel**, when the repo has a UI kit: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs` in the checkout and take `config.uiKit` (see **Configuration** in `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`). Read that artifact once for its usage, then publish one comparison page per Issue with the Artifact tool, copying the kit's files from it server side through `files` (`{"artifact": <uiKit>, "path": <file>}`). Render today's screen and each option from the real markup, transcribed from the default branch, with example data marked as examples. Republish the same page as rounds go on rather than one per question.

Next to the question, name the page and each option's key (`Q3: options a / b / c on <url>`). Never run the app or a browser to capture screens for this; a comparison costs one HTML file. The page is private to its owner; if someone else will implement or review, say that it has to be shared with them.

## 4. Return the choice

When the person has chosen, give back three things for the spec:

- The two lines `spec` writes right after the Goal line. Each starts its line exactly as shown, because `execute` reads them:

  ```text
  UI: yes
  Placement: <chosen option> (<comparison page URL>)
  ```

- A decision for **Decisions** that names the host and widths from step 1, the chosen option and the components to reuse from step 2, with the reason: `D<n>. <placement>: <reason>, reusing <components>`.
- Nothing else. The spec holds the choice; `implement` reads the reuse list from it.
