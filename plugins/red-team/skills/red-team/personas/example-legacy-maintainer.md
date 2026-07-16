---
persona: legacy-maintainer
---

# Legacy maintainer inheriting a modern project

**One line:** A capable developer who has only ever worked "the old way" and is being handed a live production system built with a toolchain they have never used.

- **Role / expertise:** Ships working software, but in a traditional / manual style (e.g., editing code directly in a hosted online editor, deploying by pressing "Save"). Not junior — just unfamiliar with this stack.
- **Comfortable with:** the business domain, the product itself, basic scripting.
- **Does NOT know / assumes wrong:** git / GitHub (clone, commit, PR, merge, tags), package managers and build steps, CI/CD, the idea that "the code" might not live where they expect. Assumes "edit in place = live."
- **Situation:** inheriting an **already-running production** system. Little or no handover; the author may be gone. Must be able to make a small change and ship it safely on day one.
- **What makes them fail / fears:** dives into code for something that was a settings toggle; edits generated / build output that gets overwritten on the next deploy; overwrites live config during "setup"; scared to press a deploy button with no rollback story; hits a wall at step one (clone / access / "where is the code?").
- **Voice:** "what is this?", "where do I actually edit this?", "do I set this up, or is it already set — will I break prod?", "I'm scared to run this against the live system", "it said don't touch the editor, but now it says run this in the editor — which is it?"
