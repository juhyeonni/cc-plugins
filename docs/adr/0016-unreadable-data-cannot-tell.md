# Unreadable data counts as "cannot tell", never as zero

Status: Accepted

A report or metric that cannot read a signal counts it as "cannot tell", shown on its own, never as zero or as a clean result. Examples: a verdict marker without a SHA, a revert line whose SHA maps to no PR, a `missed-by-verify` label without a trusted marker comment.

Why: a missing signal that reads as a clean result makes a metric look good exactly when its data is broken. Counting reverts alone gave 0 in this repo because missed bugs are fixed with new Issues, not reverts.

Source: #195 D14 (https://github.com/juhyeonni/cc-plugins/issues/195#issuecomment-6631742518)
