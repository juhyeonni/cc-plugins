# Trust is decided by login

Status: Accepted

A comment's author is trusted by login: the person running the skill, the `trusted` list in the default branch's `.github/macro-loop.json`, or else the owner of a user-owned repo. Never by author association.

Why: `MEMBER` is not a permission check, and the permission endpoint is blocked in cloud sessions.

Source: #13 D2 (https://github.com/juhyeonni/cc-plugins/issues/13#issuecomment-5975352031)
