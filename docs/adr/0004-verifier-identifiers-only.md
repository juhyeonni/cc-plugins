# A verifier gets identifiers only and its own worktree

Status: Accepted

Each verifier gets identifiers only and fetches the rest itself, in its own disposable worktree. `plugins/macro-loop/scripts/identifier-lines.mjs` is the canonical list of the lines a verifier's prompt may hold; the hook refuses any other line.

Why: a free-text note from the implementing session steered a verdict to PASS on a false criterion.

Source: #13 D1 (https://github.com/juhyeonni/cc-plugins/issues/13#issuecomment-5975352031)
