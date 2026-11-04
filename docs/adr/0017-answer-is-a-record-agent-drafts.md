# An answer to a finding is a record, and an agent only drafts it

Status: Accepted

An answer to a verify finding (`wrong`, `intended` or `minor`, with a reason) is a PR comment of its own, under the marker `<!-- macro-loop:answer round=N -->`. It is a record only: it never changes a verdict, and `verdict.mjs` does not read it. `implement` may draft answers for findings it judges wrong or not worth fixing, but posts only the ones a person approves; a finding whose answer is rejected is fixed as usual. The marker and trust rule of ADR-0003 applies to answers as it does to the spec and the verdict.

Why: an agent that fixes a false finding spends a commit and a round, and an agent that dismisses a true finding on its own could reach PASS. Dismissing a finding safely needs a check that the code it points at is unchanged, which is #198's work; until then an answer must not be a way to turn NEEDS-FIX into PASS.

Source: #196 D6 and D7 (https://github.com/juhyeonni/cc-plugins/issues/196#issuecomment-6631738032)
