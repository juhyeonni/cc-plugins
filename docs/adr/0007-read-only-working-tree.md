# Early stages leave the working tree alone

Status: Accepted

`triage`, `grilling` and `spec` never write to the checkout and never run the repo's own code in it, even with `--help`. Code that must run goes to a subagent with worktree isolation.

Why: `grilling` ran `git checkout -- .`, and a generator ignored `--help` and rewrote files.

Source: #13 D4 (https://github.com/juhyeonni/cc-plugins/issues/13#issuecomment-5975352031)
