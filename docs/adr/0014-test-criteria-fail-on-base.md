# A test criterion counts only when its test fails on the base

Status: Accepted

A `check: test` criterion is met only when its test fails on the base and passes on the head. A test that also passes on the base leaves the criterion unmet, unless the spec line marks it `(guards existing behavior)`. Every verdict shows, on its own line under the heading, how many criteria ran, were read, or are manual. A PASS stays possible when nothing ran, with the counts showing it. The verifier counts how each criterion was judged; it does not judge whether a check is evidence of behavior.

Why: a test that passes before the change does not show the change, which is the rule `cmd` checks already follow, and test-generation benchmarks (SWT-bench, TDD-Bench) do not count such a test as a success. Without the counts, a PASS that rests on reading alone looks the same as one that rests on runs.

Source: #163 D1, D2 and D3 (https://github.com/juhyeonni/cc-plugins/issues/163#issuecomment-6594207427)
