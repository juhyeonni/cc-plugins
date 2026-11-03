# A script writes the verdict from the verifiers' data

Status: Accepted

`scripts/verdict.mjs` decides the verdict and writes the comment, opening paragraph included, from the data block each verifier report ends with (a fenced `macro-loop-report` block of JSON). It reads data, never prose. It decides by verify's rules: INCONCLUSIVE when could-not-run is not empty, NEEDS-FIX when a criterion is unmet or wrong or a failure is introduced, else PASS. A missing or invalid block is INCONCLUSIVE and nothing is posted. `verify` and `execute` post its output unchanged. A verifier call whose prompt holds a line that is not an identifier line is refused, naming the line, rather than stripped.

Why: the session that wrote the change wrote the part of the verdict a person reads first. Stripping an extra line from a verifier's prompt would erase the sign that a note was added (ADR-0004), and a script that cannot read its input fails closed, as `trust.mjs` does (ADR-0009).

How the reports reach it: `scripts/verifier-report.mjs`, a SubagentStop hook, saves each verifier's last message when it stops, and `verify` passes the script the verifiers' agent ids, so the session never copies a report (#176).

Source: #164 D1, D2, D3 and D4 (https://github.com/juhyeonni/cc-plugins/issues/164#issuecomment-6595450265)
