# The config is read from the default branch only

Status: Accepted

`.github/macro-loop.json` counts only as it stands on the default branch, never from the working tree or a PR branch.

Why: a PR could otherwise add its own author to the `trusted` list.

Source: #13 D2 (https://github.com/juhyeonni/cc-plugins/issues/13#issuecomment-5975352031)
