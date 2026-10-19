# A UI placement is chosen before implement and recorded in the spec

Status: Accepted

An Issue that changes what a person sees gets its placement chosen against the real screen before `implement`, and the choice is recorded in the spec as the lines `UI: yes` and `Placement: <option> (<page URL>)`. `execute` leaves out a UI Issue with no `Placement:` line; run directly, `implement` warns and records `skipped:ui-placement`.

Why: in a real `execute` run, an agent put a new field where the code made it cheapest, and a person rejected it on sight; two redrawn proposals were wrong because the screen had not been read. A placement is a decision a person makes by seeing it, so it has to be made before the build, and written where `verify` and `execute` can find it.

Source: #115 D4 and D5 (https://github.com/juhyeonni/cc-plugins/issues/115#issuecomment-6267430904)
