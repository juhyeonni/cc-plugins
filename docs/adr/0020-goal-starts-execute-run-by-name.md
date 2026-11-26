# A goal run starts the saved workflow execute-run by name

Status: Accepted

`goal` carries out `execute`'s steps itself, reading `execute`'s skill file rather than calling it, and starts the saved workflow `macro-loop:execute-run` with the Workflow tool's `name`. It never starts it by `scriptPath` and never runs its script inline. If the saved workflow is refused or not found, the run stops and says so. `execute` keeps `disable-model-invocation`.

Why: the person started `goal`, so the run is theirs, but `execute` is user-only and a Skill-tool call to it is refused. A run started by `scriptPath` or inline is not the saved workflow the person approved: the #260 run used `scriptPath` from the dev checkout and mixed an installed verifier with main's `verdict.mjs`. Lifting `disable-model-invocation` would let the model start the costly workflow on its own.

Source: #232 (https://github.com/juhyeonni/cc-plugins/issues/232#issuecomment-7193937638)
