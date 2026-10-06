# macro-loop-band

A one-line band above the Claude Code prompt while `next`, `implement`, `verify` and the other macro-loop skills work on an Issue. It says which Issue, its stage, and whose turn it is, so you can look away during a long run. After the text it links the GitHub pages the next step needs (see [Links](#links)).

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

## Symbols

| Symbol | Meaning |
|---|---|
| ▶ | Claude is working |
| ◆ | your turn |
| ◇ | someone else's turn |
| ? | the stage could not be read |
| ✓ | done (cleared at the next turn) |

Color only repeats the symbol.

## Band text

| State | Band |
|---|---|
| Claude working | `▶ #12 verify · PR #109 · round 2 · 14m` |
| Interview waiting on you | `◆ #108 grilling · answer the questions above` |
| PASS, merge is yours | `◆ #12 PASS · read verdict, merge PR #109` |
| `stop` | `◆ #12 stopped · NEEDS-FIX 3× · decide` |
| A skill asked a question, the turn ended | `◆ #12 implement asks · see above · 3m` |
| `resumable` | `◆ #93 new reply · run /macro-loop:next 93` |
| `wait` | `◇ #101 waiting on requester · 2h` |
| `stage.mjs` failed | `? #12 stage check failed · /macro-loop:status` |
| `done` | `✓ #12 done` |
| A tool call needs approval | `◆ #12 verify · approve the tool call` |

- `+N waiting (#<n> <stage>)` is appended when other Issues of this session wait on you; it names the newest.
- Elapsed time is whole minutes, then hours (`14m`, `1h5m`, `2h`), redrawn every minute.
- PR and round appear only when the session saw them. With a GitHub remote the PR number is not in the text: it is the `PR #<p>` link instead (the table shows the band without a GitHub remote).

## Links

After its text the band shows one to three links to the GitHub objects the next step needs, first link first:

| Row | Links |
|---|---|
| `triage`, `grilling` | `#<n>` |
| `spec`, `implement` | `spec` |
| `open-pr`, `verify` | `PR #<p>` · `spec` |
| after a NEEDS-FIX verdict (`implement`, `stopped`) | `verdict` · `PR #<p>` |
| PASS | `PR #<p>` · `verdict` |

For example `◆ #12 PASS · read verdict, merge the PR · PR #109 · verdict`.

- `#<n>` opens the Issue, `spec` its spec comment, `PR #<p>` the pull request, `verdict` the PR's last verify verdict.
- A link shows only for an id the session saw: the spec, the PR's last verdict and its result come from macro-loop's `trust.mjs` output, the PR also from `open-pr` creating it. One not seen is left out; the others stay.
- Owner and repo come from `git remote get-url origin`, read once per session (`https://github.com/o/r.git`, `git@github.com:o/r.git` and `ssh://git@github.com/o/r`). With no GitHub remote the band shows no links and the text keeps the PR number.
- The labels read as plain text where a terminal cannot click. The terminal draws each as an OSC 8 hyperlink, the desktop app as an anchor.
- In herdr on macOS, Ctrl+click opens a link; Shift+Cmd+click leaves it to the terminal's own link handling. Elsewhere, click the way your terminal opens OSC 8 links (often Ctrl+click or Cmd+click).

## Narrow terminals

The band drops the counter, then elapsed time, then round, then the links from the right (PR among them), then the action. The symbol and the Issue number always stay, and so does the `#<n>` link of a `triage` or `grilling` row.

## Limits

- State lives in memory: it is cleared on `/clear`, `--resume` and a plugin reload. A resumed `next` refills it at its next stage check.
- Subagent activity is ignored.
- After you approve a tool call, the band returns to `▶` once a long Bash call draws its run-in-background row, else when the call finishes: the engine has no event between the decision and the tool running.

## Archive or remove

Delete the path from `CLAUDE_CODE_PLUGIN_DIRS`, then delete the `plugins/macro-loop-band` folder.
