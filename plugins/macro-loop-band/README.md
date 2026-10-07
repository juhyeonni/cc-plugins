# macro-loop-band

A band above the Claude Code prompt while `next`, `implement`, `verify` and the other macro-loop skills work on Issues: one row per Issue this session touched, saying how far along it is, whose turn it is, and what you do next, so you can look away during a long run. Each row links the GitHub pages its next step needs (see [Links](#links)).

It only observes: no GitHub calls (one local `git remote get-url origin` per session, for the links), no changes to macro-loop. It is an experiment, not in the marketplace and without a version.

## Requirements

- Claude Code 2.1.287 or later (mods).
- The `macro-loop` plugin installed.
- The band is drawn in the terminal and the desktop app only. In VS Code, mobile, `-p` and the SDK nothing is drawn; use `/macro-loop:status` there.

## Load it

Add this folder's absolute path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (your user settings, never a project's):

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\you\\cc-plugins\\plugins\\macro-loop-band" }
```

Several folders are separated by the platform's path-list separator (`;` on Windows, `:` elsewhere); `~` is allowed. The plugin loads in terminal and desktop sessions started after the change and reloads when a file in it is saved. `claude --plugin-dir <folder>` works for one session.

## The band

```text
▶  #12   ●●●●◐○  verify                  r2  14m     [Spec]  [PR#109]
◆  #7    ●●●●●◐  merge     merge the PR  r3  34m     [Spec]  [PR#110]  [Verdict]
◆  #108  ●◐○○○○  grilling  answer Qs         24m
◆  #93   ◐○○○○○  triage    read reply        24m
```

Each row is one Issue, in fixed columns: symbol, Issue number, progress track and stage, what you do, verify round, elapsed time, then one column per document: spec, PR, verdict. A column keeps its place on every row, so a time or an action that changes length moves nothing after it. The Issue being worked on comes first, then the others in the order they stopped, oldest first. Past four Issues the band shows four rows and `+N more · /macro-loop:status`. A done Issue leaves at the next turn.

| Symbol | Meaning |
|---|---|
| ▶ | Claude is working |
| ◆ | your turn |
| ◇ | someone else's turn |
| ? | the stage could not be read |
| ✓ | done |

The symbol, the track and the action are drawn in the row's color; the stage, round and time are dim. Color only repeats the symbol.

**Track.** Six cells: triage, grilling (with spec), implement, open-pr, verify, merge. `●` passed, `◐` where the Issue is, `○` still ahead. `wait` and `resumable` sit on triage; a NEEDS-FIX verdict sends the Issue back to implement; `stop` and a failed stage check keep the last position seen.

| State | Stage | What you do |
|---|---|---|
| Claude working | the skill's stage | (nothing) |
| Interview waiting on you | `grilling` | `answer Qs` |
| PASS, merge is yours | `merge` | `merge the PR` |
| `stop` | last stage seen | `decide: NEEDS-FIX 3×` (or another short reason) |
| A skill asked a question, the turn ended | the skill's stage | `answer above` |
| `resumable` | `triage` | `read reply` |
| `wait` (◇) | `triage` | `(requester)` |
| `stage.mjs` failed (?) | last stage seen | `run /macro-loop:status` |
| `done` (✓) | `merge` | (nothing) |

- Elapsed time is whole minutes, then hours (`14m`, `1h5m`, `2h`), redrawn every minute: how long Claude has worked, or how long the row has waited on someone.
- The round (`r2`) and the PR appear only when the session saw them.

## Links

Each row's Issue number opens the Issue. At the band's right edge come the Issue's documents, each in its own column whatever the stage, so they line up from row to row:

| Column | Opens |
|---|---|
| `[Spec]` | the Issue's spec comment |
| `[PR#<p>]` | the pull request |
| `[Verdict]` | the PR's last verify verdict |

- A document shows only once the session saw its id: the spec, the PR's last verdict and its result come from macro-loop's `trust.mjs` output, the PR also from `open-pr` creating it. A cell not seen stays empty; the others stay.
- Owner and repo come from `git remote get-url origin`, read once per session (`https://github.com/o/r.git`, `git@github.com:o/r.git` and `ssh://git@github.com/o/r`). With no GitHub remote the band shows no documents and the Issue number is plain text.
- The labels read as plain text where a terminal cannot click. The terminal draws each as an OSC 8 hyperlink, the desktop app as an anchor.

## Narrow terminals

Whole columns drop, never parts of one row, so the rows stay lined up: the round first, then the time, then the action, then `[Verdict]`, `[Spec]` and `[PR#<p>]`, then the track. The symbol, the Issue number and the stage always stay.

## Limits

- State lives in memory: it is cleared on `/clear`, `--resume` and a plugin reload. A resumed `next` refills it at its next stage check.
- Subagent activity is ignored.
- One session's band knows only that session's Issues. To see every open Issue, run `/macro-loop:status`.
- While a permission dialog is up, the terminal does not draw the band; the dialog is the signal.
- Opening a link depends on the terminal. In the Windows fullscreen CLI, Alt+click opens it once (Ctrl+click opens it twice: the fullscreen UI and the terminal both handle it). In herdr on macOS, Ctrl+click opens it; Shift+Cmd+click leaves it to the terminal's own link handling. Elsewhere, click the way your terminal opens OSC 8 links (often Ctrl+click or Cmd+click).
- Where Claude Code does not detect OSC 8 support (the Windows fullscreen CLI among them), links are drawn as the label followed by the full URL. Set `"FORCE_HYPERLINK": "1"` in the `env` block of `~/.claude/settings.json` to get the short labels.

## Archive or remove

Delete the path from `CLAUDE_CODE_PLUGIN_DIRS`, then delete the `plugins/macro-loop-band` folder.
