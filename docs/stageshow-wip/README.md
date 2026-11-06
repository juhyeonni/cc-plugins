# Stageshow demos (work in progress)

Temporary branch. Three demos built with the `stageshow` skill while exploring how to show macro-loop in its README. Not wired into any plugin.

| Folder | What | State |
|---|---|---|
| `examples/gh-readme/` | The cc-plugins README on github.com: copy the Setup command, paste it into Claude Code, install a plugin | Done, `--gate` passed at 1280 and 390 |
| `examples/macro-loop-tour/` | One Issue through triage → grilling → spec → implement → open-pr → verify, with the stage rail and the macro-loop-band row | Formats and content to be redone (see the tracking Issue) |
| `examples/macro-loop-goal/` | A `goal` run: rounds strip, tracking Issue task list, band rows for the goal and its children | Layout only; content is placeholder text, to be replaced with the dashboard goal |

## Run

The demos import the stageshow kit as `../../kit`. Copy each folder into the stageshow skill's `examples/` and use its playground:

```sh
cp -RL ~/.claude/skills/stageshow /tmp/ss && cp -R docs/stageshow-wip/examples/* /tmp/ss/examples/
cd /tmp/ss && npm install && npm run dev        # then open /?example=macro-loop-tour
node scripts/film.mjs "<url>/?capture=macro-loop-tour" --select '#example' --every 700 --count 40 --gate --out shots/loop.png
```

`macro-loop-goal` and `macro-loop-tour` share `macro-loop-tour/tour.css`; both use `gh-readme/octicons.tsx`.
