# A goal run asks the person nothing between its rounds

Status: Proposed

Inside `goal`, `grilling` and `spec` ask the person nothing. A technical decision is settled by reading the code and by research, and goes into the spec's Decisions with its reason and source. A domain decision, or a one-way door, is written to the question queue on the tracking Issue, and only the child it blocks is held as `needs-decision`. The person answers the queue in the one question round.

A `skipped:*` warning inside `goal` is recorded as the label without asking. The reason goes on the tracking Issue.

A one-way door is one of these:

- an irreversible deletion or destruction;
- a change to a public interface or a data format;
- weakening security;
- bypassing review, or affecting others.

Only what the person authorized is authority. What the agent chose on its own stays unauthorized until the person says so, so an agent never answers a queued question itself.

How it relates to the earlier decisions:

- ADR-0005: it narrows it inside `goal` only. The question is dropped; the label stays and a missing input still never blocks.
- ADR-0011: it agrees. The queue is read per Issue, by a marker, and is not an index across Issues.
- ADR-0017: it extends the principle. An answer belongs to the person, and an agent only drafts it.

Why: a person who is not there cannot answer, and a run that waits on one stops, often after the person has left. A conventional answer needs no person, so research settles it. A decision the next round cannot undo does need one, so it waits in the queue while the rest of the run goes on. The kinds of one-way door are adapted from the block categories in https://www.anthropic.com/research/claude-code-auto-mode.

Source: #217 D1 to D7 (https://github.com/juhyeonni/cc-plugins/issues/217#issuecomment-6656461995)
