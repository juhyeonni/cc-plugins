# External tools and skills are used unchanged

Status: Accepted

macro-loop uses externally maintained tools and skills, such as Claude Code's bundled `/security-review`, as they ship. It customizes them only through their official settings, never by copying, overriding or editing their prompts.

Why: a copy or an override stops the maintainer's updates from reaching macro-loop, and the tool's output format is not a contract. So macro-loop reads only the data block its own agent writes around the tool's output (ADR-0015), and a rule of our own goes in the tool's settings file, if it has one.

Source: #197 D14 (https://github.com/juhyeonni/cc-plugins/issues/197#issuecomment-6631733366)
