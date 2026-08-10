# Clear Draft

**Ask for the missing inputs first, then write the draft.**

## Why

Writing lands or fails on **input**, not on prose.

Ask an agent for a bug report and you get this:

> Login seems broken for some users after the last deploy — might be related to
> the session changes. Could someone take a look when they get a chance?

Nothing is wrong with those sentences. They are missing everything the reader
needs: who is affected, how to reproduce it, who acts, by when. None of it was
in the prompt, so no amount of rewriting recovers it.

clear-draft asks first. Four questions, then:

> **SSO login has failed since 4.2.0** (Mar 3, 14:00 KST). Password login is
> unaffected.
>
> **@auth-team — rollback or forward fix? I need the call by Thu.** Not touching
> it until then.
>
> Repro (3/3): log out → `/login` → "Continue with Okta" → back at `/login`, no
> session. The callback's `Set-Cookie` lost `SameSite=None` in #1841, and Chrome
> drops it on the cross-site redirect.

Same model, same facts — facts you already had. The four questions pulled them
out of your head *before* the draft instead of after the third review round.

(The example above is illustrative, not a real incident.)

## Use

- "Write a GitHub issue for this bug."
- "Turn these notes into a Slack message for the team."
- "정리해줘" / "명확하게 써줘" / "이거 어떻게 전달하지"

Skip it for pure code generation, or for questions the user just wants answered in chat.

## How it works

1. **Slot diagnosis** (internal) — fills seven slots from what the user already gave: deliverable, outcome, audience, key sentence, evidence, ask, constraints.
2. **Questions** — only the empty slots that are expensive to get wrong, ordered `outcome > audience > ask > key sentence > evidence > constraints > deliverable`. Budget: **max 4 per round, max 2 rounds**, asked through `AskUserQuestion` with a recommended option first. Leftover blanks become `[가정: ...]` markers in the draft.
3. **One-line BLUF** — the core sentence is confirmed with the user *before* drafting. If it can't be written, the user doesn't know yet either — and the skill says so instead of drafting around it.
4. **Draft** — C-C-C (Context → Content → Conclusion), conclusion first, one point per paragraph, verbs over noun chains.
5. **Self-check** — a pre-submit checklist (first 3 lines carry the whole message, the ask names an owner and a deadline, no dangling `이것/그것`, no unearned hedging, sentences under ~70 chars for ko/ja).

Unattended runs (scheduler, background) skip the questions, fill every slot by inference, and state the assumptions up front.

## Contents

| Path | What |
|---|---|
| `skills/clear-draft/SKILL.md` | The ask-then-write loop: slot diagnosis, question budget, BLUF gate, self-check. |
| `skills/clear-draft/references/formats.md` | Skeletons per deliverable — chat/Slack, GitHub issue, PR description, email, doc, paper. |
| `skills/clear-draft/references/principles.md` | Sentence and paragraph principles with sources (Gopen & Swan, 文化庁 公用文作成の考え方, hedging research, journal style rules). |
| `skills/clear-draft/references/examples.md` | Real published abstracts as models (Watson & Crick, Shannon, Vaswani et al., NEJM) plus Before/After rewrites in Korean, English, and Japanese. |

## Design notes

- **Question budget is a hard cap.** Interrogation is its own failure mode — past four questions the user disengages and answer quality drops. Unknowns become visible assumptions instead.
- **Options are scenarios, not dials.** "Detailed / normal / brief" tells the user nothing. "3-line summary (for people skimming the thread)" vs "with repro steps (for whoever fixes it)" makes the choice by audience and use.
- **The BLUF gate is the real value.** Confirming one sentence before drafting kills the most expensive failure — a polished draft pointed the wrong way.

## Install

Add the marketplace first (see the [repo README](../../README.md)), then:

```
/plugin install clear-draft@juhyeonni
```

Restart Claude Code after installing.

For local testing:

```bash
claude --plugin-dir ./plugins/clear-draft
```
