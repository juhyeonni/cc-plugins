# Trust is decided by one script

Status: Accepted

`scripts/trust.mjs` decides trust and finds the spec and verdict. Skills run it and never apply the rule by hand. It fails fast: on a failed `gh` call or invalid config it exits non-zero and prints nothing.

Why: models skipped the config read or the trusted lookup in many runs, and a partial result reads as "nobody is trusted".

Source: #39 D2, D6 (https://github.com/juhyeonni/cc-plugins/issues/39#issuecomment-5977156295)
