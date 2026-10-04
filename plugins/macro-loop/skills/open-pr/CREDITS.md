# Credits

The PR body template in [SKILL.md](SKILL.md) comes from the `pr` skill in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, commit `d81f3a1`; see [NOTICE.md](../../NOTICE.md)). `open-pr` adds what `pr` leaves out: it creates the PR and links the Issue with `Closes #<n>`.

The `show-me` skill it names lives at <https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md>, the source `pr` records in its frontmatter.

The credit that `pr` carries, reproduced from its `CREDITS.md`:

> # Credits
>
> The **Summary** section's menu of visuals (pseudocode, call trees, component trees, file trees, Mermaid, diffs) and its placement guidance come from [Dex Horthy](https://github.com/dexhorthy)'s [`show-me`](https://github.com/humanlayer/humanlayer) skill, reproduced almost word for word and aimed at a diff instead of a live conversation. `pr` does not depend on `show-me` as a skill (it isn't part of this repo, and a hard dependency would break standalone installs), so the content is copied in rather than pointed at; this file is the attribution a dependency would otherwise have carried.
