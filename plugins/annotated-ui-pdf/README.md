# annotated-ui-pdf

Screenshot a web app and produce a PDF that outlines chosen UI elements with
**numbered boxes + short captions**. It's a general-purpose "explain on top of a
screenshot" tool, useful for:

- Release notes (what changed)
- Bug reports (point at the problem)
- Design / QA review feedback
- How-to guides / onboarding
- Design specs, before/after comparisons

## Install

Add the marketplace first (see the [repo README](../../README.md)), then:

```
/plugin install annotated-ui-pdf@juhyeonni
```

Restart Claude Code after installing.

## Requirements

The plugin itself has no npm dependencies, but running the skill needs:

- **Node.js**
- **Playwright MCP** (`browser_navigate` / `browser_evaluate` / `browser_take_screenshot` / `browser_resize`)
- A headless **Chrome / Chromium / Edge** (auto-detected; override with `CHROME_PATH`)

## Usage

Ask Claude something like (trigger phrases):

- "Annotate the UI and export a PDF"
- "Box the changed parts and make a PDF"
- "Screenshot these screens and mark the changes"
- "Make a visual changelog / bug report / how-to PDF"

The full procedure lives in `skills/annotated-ui-pdf/SKILL.md`.

## What the build produces

`skills/annotated-ui-pdf/scripts/build.mjs` turns a `spec.json` (screens +
screenshots + boxes-in-pixels + captions) into HTML and renders a PDF via
headless Chrome. It has no npm dependencies. Highlights (v0.2.0):

- **Validation** — typos in `kind` / `variant` / `level`, missing fields,
  duplicate `id`s and unresolved `{ref:}` fail the build instead of silently
  dropping content from the document.
- **Blocks** — `callout` (warning), `table`, `steps`, `checklist`, and
  image-less pages (e.g. a table-of-contents or glossary page).
- **Stable references** — give a page an `id` and write `{ref:id}` in any text;
  it resolves to the real page number at build time, and every sheet gets an
  `n / N` footer. One spec page must equal one printed sheet, enforced after
  rendering.
- **Box variants** — `warning` (dashed + tag) and `result` (double line + tag)
  encode meaning in shape and label, so it survives black-and-white printing.

See `skills/annotated-ui-pdf/examples/spec.example.json` for a reference spec.

## Versioning

The version lives in `.claude-plugin/plugin.json` (`version`). Bump it whenever
you ship an update — installs won't pick up changes otherwise. The repo README's
plugin table is generated from these manifests by `scripts/gen-readme.mjs`.
