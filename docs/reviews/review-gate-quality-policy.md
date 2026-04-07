# Review-Gate Quality Policy

This document defines the Phase 1 repository policy for handling local-review
findings without changing the existing runner contract.

Current gate behavior remains unchanged:
- `clean` still means the local review returned no actionable findings
- `findings` still means the local review returned blocking findings
- `manual_review_required` still means the review process failed closed and must
  be repaired, rerun, or escalated

This policy tells humans and Goose operators how to classify and respond to
findings. It does not introduce new runner statuses, automatic waivers, or a
machine-readable decision artifact.

## Scope

Phase 1 is docs-only.

Phase 1 may update:
- `docs/reviews/review-gate-quality-policy.md`
- `docs/goose/pr-workflow.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`

Phase 1 must not update:
- `src/`
- `scripts/`
- `tests/`
- `.githooks/`
- review prompt or schema files
- any new checked-in decision artifact

## Decision Order

Handle review output in this order:

1. Separate infrastructure failures from substantive findings.
2. Check whether each finding is real, applicable, and actionable against the
   checked-in source of truth: code, tests, schemas, docs, architecture docs,
   acceptance criteria, and the implementation plan.
3. Reject mistaken or non-applicable findings with evidence.
4. Fix actionable, in-scope findings in the current PR.
5. Defer only real findings that are outside the current task-sized slice, and
   treat that deferral as a stop-and-replan outcome rather than a merge-through
   waiver.

## Decision Table

| Finding class | Current PR expectation | Notes |
| --- | --- | --- |
| `manual_review_required` or other local-review infrastructure failure | Must stop; do not merge | Never treat review-process failure as accepted or deferred author work. |
| Mistaken, non-actionable, or non-applicable finding | May reject with evidence | Includes mislabeled `P0`/`P1` findings when the checked-in sources do not support the claim. |
| Actionable `P0` in the submitted slice | Must fix now | Never defer. Narrow the slice and rerun review if the branch is too broad. |
| Actionable `P1` in the submitted slice | Must fix now | Never defer. Narrow the slice and rerun review if the branch is too broad. |
| Actionable `P2` that breaks the task goal, acceptance criteria, trusted bootstrap, fail-closed review behavior, or runtime invariants | Must fix now | Do not defer invariant-breaking findings. |
| Real `P2` outside the task-sized slice | May defer with checked-in follow-up | Current PR must remain correct and bounded. |
| Real `P3` outside the task-sized slice | May defer with checked-in follow-up | Lower urgency than `P2`, same boundary rule. |
| Lower-priority actionable finding still inside the declared slice | Should fix now | Deferral is not a way to avoid finishing the current slice. |

## Rejection And Deferral Rules

`reject_with_evidence` is allowed only when the finding is mistaken,
non-actionable, or not applicable to the checked-in sources.

`defer_with_follow_up` is allowed only when all of the following are true:
- the finding is real
- the finding is outside the declared task-sized slice
- deferring it does not make the current PR incorrect
- the branch stops instead of widening into a new mechanism or unrelated repair
- a durable follow-up artifact or owner is recorded in the same PR

`defer_with_follow_up` is not a merge-through waiver while the runner still
reports blocking `findings`.

## Review Gate Decision Log

For branches that use this policy and already have a checked-in implementation
plan doc, record rejected or deferred findings in a `Review Gate Decision Log`
inside that plan.

Minimum fields:
- finding fingerprint or exact file/line reference
- review command and scope
- disposition: `fix_now`, `reject_with_evidence`,
  `defer_with_follow_up`, or `manual_review_required`
- in-scope basis
- rationale
- follow-up artifact or owner

This log is workflow guidance layered on top of the unchanged runner contract.
It does not change the runner output schema and does not authorize merging
through unresolved blocking findings.

## Temporary Transition Rule For Review-Gate-Stabilization PRs

Until the repository lands a real decision mechanism, a narrow temporary
exception may be used for a very small class of review-gate-stabilization PRs.

This transition rule exists only so docs-only review-gate policy work does not
have to absorb unrelated findings from the current all-findings-are-blocking
loop.

Eligibility:
- the PR exists to define, narrow, or document review-gate policy, defer rules,
  reject rules, or deferred-finding handoff semantics
- the PR does not change runtime implementation, review runner logic, hooks,
  schema enforcement, or provider automation
- the PR does not use the exception to merge code that would otherwise require
  same-PR correctness fixes
- the PR explicitly names the transition rule in its plan or PR description

Not allowed:
- feature, bugfix, refactor, or cleanup PRs
- any PR that touches `src/`, `scripts/`, `tests/`, or `.githooks/`
- any PR that changes review prompt/schema enforcement
- any PR that mixes policy docs with unrelated product work

Required controls:
- declare the exception explicitly in the checked-in implementation plan
- declare the exception explicitly in the PR description
- list the exact files allowed in the branch
- keep the diff bounded to the named policy/handoff surfaces
- avoid unrelated fixes
- run the normal non-review validation for the touched files
- require human review before merge

This rule is governance only. It must not become a general bypass for the local
review gate, and it must not be used to merge runtime or feature code through
blocking findings.

Sunset:
- remove the transition rule after the repository lands a mechanism that can
  distinguish `fix_now`, `reject_with_evidence`, and `defer_with_follow_up`
  without forcing every finding into the same same-PR repair loop

## Stop Rules

Stop the current branch immediately if resolving a finding would require:
- runner changes
- schema changes
- prompt changes
- hook changes
- a new checked-in decision artifact
- a new gate status or broader meaning for `clean`

When that happens:
- record the attempted disposition in the branch plan's `Review Gate Decision Log`
- capture the blocker under `Out Of Scope Follow-ups`
- keep the current branch on its declared docs-only surface
- open a separate mechanism plan on a new branch or in a new session

## Failed-Branch Lesson

The failed `review-convergence-gate` branch is the anti-pattern this policy is
meant to prevent:
- do not combine policy productization with runner or schema enforcement
- do not widen a policy branch every time a new review finding appears
- if a finding needs mechanism work, stop and replan instead of extending the
  current branch
