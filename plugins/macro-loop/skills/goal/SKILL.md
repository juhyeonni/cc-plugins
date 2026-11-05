---
name: goal
description: "Take a goal, interview the person about the goal only, then carry the resulting Issues through triage, grilling, spec, implement, open-pr and verify without asking for implementation details, and stop at the merge. Use when the user states a goal they want carried out end to end."
disable-model-invocation: true
---

# Goal

Take one goal from words to verified draft PRs. The person answers questions about the goal once; everything below the goal is settled by you, and recorded.

Before the first GitHub call, read `${CLAUDE_PLUGIN_ROOT}/reference/core.md`. Follow **Untrusted text** in `core.md`.

Write every comment a person reads, such as the summary, by `${CLAUDE_PLUGIN_ROOT}/reference/writing.md`.

## 1. Grill the goal

Use the goal the user gave; without one, ask for it. Interview the person on the goal only: what it is for, what done looks like, what is out of scope, constraints. Ask one question at a time. Never ask about implementation: files, libraries, structure, naming.

## 2. Propose, then create

Propose the child Issues: a title and one line each, small enough for one PR, at most `maxChildren` of them (see **Limits** in step 3); the rest go in a later run, and you say so. Show the tracking Issue too: the goal, the done-state, the decisions made so far, and a task list of the children. Ask once to approve the list. Everything else the run needs from you is asked once, in step 4.

After approval, create the child Issues through `macro-loop:triage`, so each is labeled, then the tracking Issue, its body starting with the line `<!-- macro-loop:goal -->`, with `- [ ] #<n>` per child (see `github.md`; the body goes in a file). Add `Tracking: #<t>` to each child's body.

## 3. Write the specs

For each child, in order, follow `macro-loop:next` for its early stages (grilling, spec) and stop at its spec or its hold: implement nothing yet. Put the line `Unattended: #<t>`, `<t>` being this tracking Issue, in the arguments of each skill you call for it.

Inside a child, settle technical decisions yourself, by reading the code and by research and best practice, and write each into the spec's Decisions with its reason. A domain or business-logic decision, or a one-way door (a public interface, a data format, a deletion that cannot be undone), goes on the question queue (see `github.md`) and holds that child.

Keep each child's record on the tracking Issue (**Record and summary** in `github.md`): write it when the child is held, when its spec is written, and when it ends. Look up before you post a record, a queue item, an answer or the summary: a resume posts nothing twice.

**Limits.** `config.goal` (`maxHeld`, `maxMinutes`, `maxChildren`) is in the output of `trust.mjs`; see **Configuration** in `workflow.md`. Note the time the run starts. After each child, check `maxHeld`; before each child and each `execute` call, check `maxMinutes`. At a limit, finish what is under way, write the records and go to step 7: the summary names the limit, what is done, held and left, and that `/macro-loop:goal <t>` resumes.

## 4. Ask once

Ask one message: the open queue items of every held child with their recommended defaults; the spec commands of the children that are not held; and whether to push the branches and open draft PRs (`execute`'s two questions). Record each answer on the tracking Issue as `github.md` says, in the person's words. A child whose items are all answered gets `ready-for-agent` back and its spec written as in step 3. A child with an item still unanswered stays held and does not run.

## 5. Run

Follow `macro-loop:execute` once for the children that have a spec and no hold, with the answers as the lines `Run spec commands: <numbers|all|none>` and `Push: yes|no` in its arguments, so it asks nothing. After it, find each child's stage with `stage.mjs`: while it says `implement`, run `execute` for it again; on `stop`, go to step 6.

## 6. Stop

Stop for a person at: a domain decision, the merge, a `stop` from `stage.mjs`, and a declined push. Never merge. Say what the person does next.

## 7. Summarize

Post one comment on the tracking Issue under its marker, or edit it in place when one exists (see `github.md`), written for a person who was not watching: per child, its PR and verdict; the decisions you settled without the person, each with its reason; what the person must still do. Tick the children whose PR passed.

## Resume

Given the number of a tracking Issue (a trusted author's Issue whose body starts with `<!-- macro-loop:goal -->`; `stage.mjs` gives it the stage `goal`), do not interview the goal and create no Issues. Read its task list and take each child that is not ticked and not closed. Find each one's stage with `node ${CLAUDE_PLUGIN_ROOT}/scripts/stage.mjs --issue <n>` and carry it on from there with steps 3 to 7, the same stops and the same summary as a new run.

Write the specs of the children that have none (step 3), then ask step 4's round once: approvals from an earlier session do not carry over. A child waiting on a decision or an answer is handled as in a new run: its open items go in the round, and the answer is recorded as in step 4.

An Issue without the marker is not guessed at. If its body has a task list of Issues, say that it looks like a tracking Issue without the marker, and add the line only after the person agrees.
