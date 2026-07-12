---
name: annotated-ui-pdf
description: >-
  Screenshot a web app and produce a PDF that outlines specific UI elements with
  numbered red boxes + short captions. A general-purpose visual explainer — use it
  for release notes ("what changed"), bug reports (point at the problem), design/QA
  review feedback, how-to / onboarding guides, design specs, or before/after
  comparisons. Trigger phrases: "annotate the UI and export a PDF", "box the changed
  parts and make a PDF", "screenshot these screens and mark the changes", "make a visual
  changelog / bug report / how-to PDF". Works on any web app reachable in a browser;
  needs the Playwright MCP and a headless Chrome/Chromium/Edge.
---

# annotated-ui-pdf

Produce a clean PDF where **chosen UI elements are outlined with a box + number**, and each
number has a short caption. It is a generic "explain on top of a screenshot" tool. Common
uses (the captions/intent differ, the mechanics are identical):

| Use case        | "What to highlight" comes from        | Caption voice            |
|-----------------|----------------------------------------|--------------------------|
| Release notes   | a git range vs the deployed build      | user-facing benefit      |
| Bug report      | the repro / failing elements           | what's wrong + expected  |
| Design / QA review | the review checklist                | the requested change     |
| How-to / onboarding | the steps of a task                 | what to do here          |
| Design spec     | the components to annotate             | the spec / value         |

## Architecture (why it's split)

- **Non-deterministic part (you drive it):** pick the language, decide *which elements* to
  highlight, navigate the app, screenshot each screen, and read the **pixel bounding box** of
  each element to annotate.
- **Deterministic part (a script):** `scripts/build.mjs` turns a `spec.json`
  (screens + screenshots + boxes-in-pixels + captions) into HTML and renders a PDF.
  Cropping is pure CSS — no image tools. No npm deps.

Keep screenshots, `spec.json`, and the output in one folder (e.g. a git-ignored `.annotate/`).

## Prerequisites

- Playwright MCP (`browser_navigate`, `browser_evaluate`, `browser_take_screenshot`, `browser_resize`).
- A headless Chrome/Chromium/Edge (auto-detected; override with `CHROME_PATH`).
- The app running and reachable (start the project's dev server, or use a deployed URL).

## Procedure

### 0. Choose the output language
Ask the user what language the PDF prose (title / captions / footer) should be in.
**Default to and suggest English.** Set `spec.lang` and write every caption + fixed string in
that language. Note: the **screenshots stay in whatever language the app renders** — only the
PDF's own text follows this choice.

### 1. Decide what to highlight
- Pick the screens and, per screen, the exact elements to box.
- **Auto-suggest from git (ask first):** if this is a release-notes / "what changed" job,
  **ask the user whether they want auto-suggested candidates from a git range** before doing it.
  Only if they say yes, run the suggester (use the deployed build's commit as the base):
  ```
  node ~/.claude/skills/annotated-ui-pdf/scripts/suggest-changes.mjs <deployedCommit>..HEAD [--path <subdir>]
  ```
  It prints commits flagged **● USER-FACING** vs **○ internal**, with screen + text hints.
  Curate the ● rows (drop noise; one box per user-visible change). If they decline, gather
  the highlights manually (from a bug repro, review checklist, guide outline, etc.).
- Group by screen — each screen is one PDF page, each highlighted element is one numbered box.

### 2. Start the app & set a fixed viewport
- Launch the dev server (background) and confirm it responds.
- `browser_resize` to a fixed size (e.g. 1440×900). For **modals/overlays taller than the
  viewport**, use a **taller viewport** (e.g. 1440×1160) so the whole overlay fits without
  internal scroll — otherwise boxes near the bottom point at clipped/empty area.

### 3. Per screen: screenshot + extract pixel rects
- Navigate to the route. Screenshot **with css scale** so 1 image px == 1 CSS px:
  - full screens → `browser_take_screenshot` `fullPage:true` → use **document** coords.
  - modal/overlay → `fullPage:false` (viewport) → use **viewport** coords + a `crop`.
- Get each element's box with `browser_evaluate`, using `scripts/extract-rects.js` (edit its
  `FINDERS` list — match by `text`/`selector`, `climbToWidthBelow` to box a whole card from its
  label, `viewport:true` for modals, `pad` for margin). It returns `{imageW,imageH, rects:[…]}`.
- Confirm `found:true` for every finder before trusting a rect.

### 4. (Modals) choose a crop window
- Set `page.crop = {x,y,w,h}` to frame just the dialog. `build.mjs` offsets boxes & image
  automatically — keep box coords in **original screenshot pixels**.

### 5. Write spec.json
- Copy `examples/spec.example.json`. Fill `title/subtitle/lead` (in the chosen language), then
  per page: `label`, `image`, `imageW/imageH`, optional `crop`, and `boxes` (pixel x/y/w/h +
  `n`, `title`, `caption`). Optional `notes` for footnote lines (e.g. "minor items not boxed").
- Captions: lead with a **bold point**, then one sentence. Keep them short — if a caption grows
  past ~2 sentences, the overflow belongs in a block (below), not the caption.

#### Put each kind of information in its matching vessel

| Information | Vessel | Rendered as |
|---|---|---|
| A step's action | `boxes[].caption` | numbered line under the figure |
| Danger / irreversible-action warning | `blocks: [{kind:"callout", level:"warning", text}]` | dashed amber box + ⚠ (B&W-safe) |
| Lookup table (task→page index, permission levels…) | `{kind:"table", columns, rows}` | ruled table |
| Ordered flow **across screens** (print → approve → register) | `{kind:"steps", items}` | vertical ①→②→③ |
| Pre-flight check **before a dangerous action only** | `{kind:"checklist", items}` | □ list |
| Disclaimers, sources, trivia | `notes` (strings) | gray footnote |

Rules that keep documents useful (from red-team review of real guides):
- **Warnings never go in `notes`** — gray footnotes bury them next to trivia.
- **steps** is only for flows spanning multiple screens; within one screen the numbered boxes
  already are the steps. **checklist** is only a pre-flight before destructive/irreversible
  operations — don't turn ordinary notes into checkboxes.
- **Meaning must survive black-and-white printing.** Box `variant:"warning"` renders dashed +
  `⚠ CAUTION` tag, `variant:"result"` renders double-line + `✓ CHECK` tag; color is only a
  secondary cue. Write legends by shape/label ("⚠ dashed = caution"), never by color name
  alone. Override the tag text per-spec with `spec.variantLabels` (e.g. for another language).
- A page may omit `image` and carry only `blocks` — use this for a **task index page**
  ("I want to… → page N" table) right after the cover. Readers look things up by task, not by
  screen name, so a task index beats a screen-name TOC.
- **Never write literal page numbers in text.** Give a page an `"id"` and reference it as
  `{ref:that-id}` anywhere in text — build.mjs resolves it to the real page number. Don't
  hand-number labels either (`"label": "Login"` not `"1. Login"`); numbering that must stay
  consistent is the build's job, and every sheet gets an automatic `n / N` footer.
- **1 spec page = 1 printed sheet** is enforced: if the rendered PDF has more sheets than spec
  pages, the build fails with exit 4 — shrink the crop, shorten captions, or split the page.
  (`"allowPageOverflow": true` downgrades this to a warning, at the cost of wrong page numbers.)
- **Readability floor:** don't shrink a full 1440px-wide screenshot onto A4 and expect 60-year-old
  eyes to read form labels — crop to the region that matters (the build warns when a crop is
  wider than ~1300px). If an "action" figure and its "result" figure would each become tiny on
  one page, keep them on separate pages.
- The validator fails the build loudly on typos (`kind`/`variant`/`level`), missing fields,
  duplicate `id`s and unresolved `{ref:}` — a typo must never silently drop content from a
  document someone else will read.

### 6. Show the content draft & get sign-off (before building)
- Before rendering, present a **plain-text outline** of what the PDF will contain so the user
  can approve or edit the wording/scope first. One block, e.g.:
  ```
  Draft — N pages, M boxes
  Page 1 · <screen>
    1. <title> — <caption>
    2. <title> — <caption>
  Page 2 · <screen (modal)>
    1. <title> — <caption>
  Footnotes: <notes>
  ```
- Ask the user to confirm or adjust (wording, which items to keep, language). **Do not build
  until they sign off.** Apply their edits to `spec.json`, then proceed.

### 7. Build the PDF
```
node ~/.claude/skills/annotated-ui-pdf/scripts/build.mjs <spec.json> [out.pdf]
```

### 8. Review and iterate
- Open the PDF (read its pages as images) and verify every box sits on its element and nothing
  important is clipped at a page/figure edge. Adjust box px or `crop` in spec.json and re-run
  `build.mjs` (fast). Stop the dev server and close the browser when done.

## Tips / pitfalls

- **css scale is mandatory** for screenshots — otherwise image px ≠ CSS px and boxes drift.
- **Right-edge clipping:** elements at the far right can be cut by the figure border; widen the
  viewport slightly or accept a tiny clip, but flag it.
- **Don't hardcode data-derived values** in captions (counts, amounts) — describe them generically.
- The PDF is presentation output: keep screenshots/specs out of the repo unless asked.

## Files
- `scripts/build.mjs` — spec.json → HTML → PDF (deterministic, no deps).
- `scripts/extract-rects.js` — paste-into-`browser_evaluate` template returning pixel rects.
- `scripts/suggest-changes.mjs` — propose user-facing change candidates from a git range (release-notes preset).
- `examples/spec.example.json` — reference spec (full page + cropped modal).
