# Writing the spec

The spec comment is the contract that `verify` judges the diff against. The Issue body and its discussion are context; the spec is what counts.

## Durability over precision

The Issue may wait for days or weeks, and the code changes meanwhile. Write the spec so it stays true when files are renamed, moved or refactored.

- **Do** describe interfaces, types and behavioral contracts.
- **Do** name the specific types, function signatures or config shapes to look for or change.
- **Don't** reference file paths or line numbers: they go stale.
- **Don't** assume the current implementation structure will stay the same.

## Behavioral, not procedural

Describe **what** the system should do, not **how** to build it. The implementer explores the code fresh and makes its own implementation decisions.

- **Good:** "The `SkillConfig` type accepts an optional `schedule` field of type `CronExpression`"
- **Bad:** "Open src/types/skill.ts and add a schedule field on line 42"
- **Good:** "Running `/triage` with no arguments lists the Issues that need attention"
- **Bad:** "Add a switch statement in the main handler function"

## Decisions carry their reasons

Each decision states why it was made. A decision without its reason gets reversed by the next person who cannot see why it is there.

## Testable acceptance criteria

The implementer needs to know when it is done, and `verify` needs something to check. Every criterion is concrete, can be checked on its own, and says how it is checked.

- **Good:** "AC2. After triage moves an Issue to `needs-info`, listing open Issues with that label includes it · check: cmd `gh api 'repos/{owner}/{repo}/issues?labels=needs-info'`"
- **Bad:** "Triage should work correctly"

A string match, such as a `grep` for a class name, shows the change was written, not how the page behaves. A criterion about what a person sees on a screen is a `test` on rendered output, or a `manual` check that names what to look at: the page, the viewport and what must be true there.

- **Good:** "AC3. The table's columns line up with the header at 950px wide and wider · check: manual, open the task list at 950px and 1440px and compare each column with its header"
- **Bad:** "AC3. The table uses fixed layout · check: cmd `grep -c table-fixed TaskTable.tsx`"

A `cmd` check must be safe and able to fail:

- It names its exact command in backticks. "check: cmd in a temporary worktree" with no command gives `verify` nothing to run or ask about.
- It changes nothing where it runs. If it has to write, such as running a generator, it says that it runs in a temporary worktree.
- It fails, by exit code, when the criterion is unmet. `git check-ignore a b c` passes if any one path is ignored, so check each path on its own. `node script.mjs; echo $?` always exits 0, so drop the `echo`. For something that must not happen, negate the command: `! git check-ignore -q .env.example` fails once `.env.example` is ignored.
- Its failure shows in the tool result. A bare `test`, `[` or `grep -q` prints nothing whether it passes or fails, and the Bash tool hides its exit code 1, so neither `spec` nor `verify` can read it. Use a command that prints or fails visibly: `ls <path>`, `git ls-files --error-unmatch <path>`, `grep -c` (it prints the count), `cmp`, or a `node -e` assertion. A `diff`, or a `grep` without `-q`, is readable through its output.
- It is a plain command: no `$(…)`, `bash -c` or shell variables. Permission checks cannot read those, and `verify` runs each check exactly as written.
- It fails on today's code when the criterion describes something not built yet. Run it once there before publishing; a check that already passes checks nothing. A check that guards existing behavior passes today; mark it `(guards existing behavior)`.

## Explicit scope

State what is out of scope. It keeps the implementer from gold-plating, and gives `verify` a line to measure scope creep against.

## Good spec

```markdown
<!-- macro-loop:spec -->
## Spec

**Goal:** Long skill descriptions are cut at a word boundary instead of mid-word.

**Decisions**
- D1. Cut at the last word boundary before 1024 characters and append "...": readers see where the text was cut, and no word is broken.
- D2. Keep the 1024-character limit: other tools read the same field and assume it.

**Acceptance criteria**
- [ ] AC1. A description of 1024 characters or fewer is unchanged · check: test
- [ ] AC2. A longer description ends at the last word boundary before 1024 characters · check: test
- [ ] AC3. A cut description ends with "..." and is at most 1024 characters long, "..." included · check: test

**Out of scope**
- Changing the 1024-character limit
- Multi-line descriptions
```

## Bad spec

```markdown
## Spec

Fix the truncation bug. The function around line 150 of src/skills/load.ts is
wrong. Make it work properly.
```

This fails on every rule: no marker, so `verify` cannot find it; no decisions or reasons; a file path and a line number that will go stale; nothing testable; no scope.
