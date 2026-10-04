---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

While grilling, the working tree is read-only: find facts by reading files, `git log` and `git show`. Never run the repo's own scripts, generators, builds or tests in the checkout, not even with `--help` or `--dry-run`: a script can ignore its flags and write anyway. Read the code to learn what it does. To see it run, dispatch the sub-agent with the Agent tool's `isolation` set to `"worktree"`: it runs in a disposable worktree, never in the checkout. That worktree can start on another commit, so the sub-agent first runs `git checkout --detach origin/<default>`, in a Bash call of its own. Never make a worktree by hand and `cd` into it. Never use `git checkout -- .`, `git restore .`, `git reset --hard` or `git clean`: they throw away uncommitted work.

Read a GitHub Issue with REST: `gh api repos/{owner}/{repo}/issues/<n>` and `gh api --paginate repos/{owner}/{repo}/issues/<n>/comments`. `gh issue` and `gh pr` call GraphQL, which Claude Code cloud sessions block.
