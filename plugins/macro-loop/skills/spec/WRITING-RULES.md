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
