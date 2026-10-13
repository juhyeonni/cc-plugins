# REST only through gh api

Status: Accepted

Every GitHub call goes through `gh api repos/...`. Skills never use `gh issue`, `gh pr` or any other `gh` subcommand.

Why: Claude Code cloud sessions block GraphQL, which those subcommands use.

Source: #1 D2 (https://github.com/juhyeonni/cc-plugins/issues/1#issuecomment-5971085521)
