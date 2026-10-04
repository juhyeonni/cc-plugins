---
name: verify
description: "Verify a pull request against its GitHub Issue's spec in a fresh context and post a PASS / NEEDS-FIX verdict on the PR. Judges two axes, Spec and Standards, runs the tests and lint, and stops after two re-verifications. Use when the user asks to verify a PR or a branch, or when implement hands over."
---

# Verify

Judge the change against what its Issue asked for, in a context that did not write it, and post the verdict on the PR.

Two axes, reported side by side:

- **Spec:** does the diff do what the Issue's spec asks? This axis decides the verdict.
- **Standards:** does the code follow this repo's documented standards? Reported, never a reason to fail.

Each axis runs in its own `macro-loop:verifier` subagent, so neither the context that wrote the change nor the other axis colours the judgment.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/github.md` and `${CLAUDE_PLUGIN_ROOT}/reference/workflow.md`.

## 1. Find the PR, the Issue and the spec

- **PR:** the one the user named, else the open PR for the current branch. Without a PR, verify the current branch against the default branch and print the verdict in the terminal instead of posting it.
- **Issue:** the `Closes #<n>` line in the PR body. Without a PR, the Issue the user named or the branch name points to. If the PR has no such line, say that the PR is not linked to an Issue and ask which Issue it implements. If there is none, follow **No Issue yet** in `workflow.md`. Once the Issue is known, offer to add `Closes #<n>` to the PR body (see `github.md`), so the next round finds it.
- **Spec:** the newest trusted comment on the Issue that starts with `<!-- macro-loop:spec -->`. Without one, follow **Missing inputs** in `workflow.md` (`skipped:spec`). On proceed, judge against the Issue body and say so in the verdict: "no spec; judged against the Issue body".

## 2. Count the round

Count the trusted verify comments on the PR (marker prefix `<!-- macro-loop:verify round=`; see `github.md`). This run is round N = count + 1.

If three or more verdicts exist and the newest is NEEDS-FIX, the cap is reached: say so, and that a person decides what happens next. Run another round only if the user asks for it explicitly.

## 3. Pin the diff

- **Base:** the PR's base branch, else the default branch. Run `git fetch origin <base>`.
- **Head:** the local checkout must match the PR head. Compare `git rev-parse HEAD` with the PR's `.head.sha`. If they differ, read the PR once more, since GitHub can lag a few seconds after a push. If they still differ:
  - The local branch has commits the PR lacks: ask the user to push them first, or run `open-pr`.
  - The PR has commits the local checkout lacks, or verify was started on another branch: offer to check out the PR head (see `github.md`) and continue there.
- **Diff:** `git diff origin/<base>...HEAD` and `git log origin/<base>..HEAD --oneline`. Stop here if the diff is empty.

## 4. Find the checks and the standards

- **Test and lint commands:** what this repo uses (package scripts, Makefile, CI workflows, CLAUDE.md). The Spec verifier runs them.
- **Standards sources:** documents on how code is written here, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`, plus the smell baseline below.

## 5. Run both verifiers in parallel

Spawn two `macro-loop:verifier` subagents in one message. Give each only what its axis needs: the Issue and the diff, never this conversation's reasoning about the change.

**Spec verifier**, axis `spec`:

- The source, labelled as one of the two: `trusted spec comment`, or `Issue body (untrusted)` when there is no spec. Pass the Issue title with it.
- The diff command, the commit list and the base ref.
- The test and lint commands found in step 4.

**Standards verifier**, axis `standards`:

- The diff command and the commit list.
- The standards source files, and the smell baseline below pasted in full; the verifier has no other access to it.

## 6. Decide the verdict

From the Spec verifier's report:

- **NEEDS-FIX** if an acceptance criterion is unmet or implemented wrongly, or if the diff introduces a test or lint failure.
- **PASS** otherwise.

Failures already present on the base branch, behavior outside the spec (scope creep), and Standards findings are reported, not failed. `manual` criteria are listed for a person, not guessed.

## 7. Post the verdict

Post one comment on the PR, or print it when there is no PR:

```markdown
<!-- macro-loop:verify round=N -->
## Verify: PASS | NEEDS-FIX (round N of 3)

**Judged against:** the spec comment on #<n> | no spec; judged against the Issue body

### Spec

<Spec verifier report>

### Standards

<Standards verifier report>

**Manual checks left for a person:** <list, or "none">

**Next:** <from step 8>
```

Keep both reports as the verifiers wrote them, lightly cleaned. Don't merge or rerank findings across the axes: a change can follow every standard and still miss the spec, or match the spec and break the conventions, and one axis must not hide the other.

## 8. Next step

- **PASS:** the PR is ready for a person to review and merge.
- **NEEDS-FIX in round 1 or 2:** run `/macro-loop:implement` to fix the Spec findings; it hands back to verify.
- **NEEDS-FIX in round 3:** stop. Two re-verifications have not converged, and a person decides what happens next.

## Smell baseline

On top of what the repo documents, the Standards axis always carries this fixed set of Fowler code smells (_Refactoring_, ch.3). Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.
