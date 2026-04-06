# Review-Gate Quality Policy Design

**Status:** Proposed

**Related Plan:** `docs/plans/2026-04-05-review-gate-quality-policy.md`

## Background

The repository already has a fail-closed local review gate with trusted same-repo bootstrap behavior, but it does not yet have a stable checked-in policy for deciding:
- which findings must be fixed in the current PR
- which findings may be rejected with evidence
- which findings may be deferred into follow-up work
- when Goose must stop rather than widen the branch

The abandoned `review-convergence-gate` branch showed the failure mode clearly: policy and mechanism were changed together, and the branch expanded into runner, schema, prompt, docs, and tests.

## Decision

Start with a docs-only, policy-first Phase 1.

Phase 1 defines the decision model and stop rules without changing:
- `scripts/run-local-codex-review.mjs`
- `scripts/lib/local-codex-review-adapter.mjs`
- prompt/schema files
- hooks
- tests

## Unimplemented Follow-Up

The repository may still need a narrow first-blocked-push exception for
review-gate-stabilization work, but that path is not part of Phase 1.

Reason:
- the unchanged local pre-push gate still blocks pushes on returned `findings`
- a docs-only policy branch cannot make a reliable first-blocked-push escape
  hatch real without widening into hook, runner, or other mechanism work

Phase 1 rule:
- if a docs-only review-gate policy branch would need a first-blocked-push
  exception to land, stop and open a separate mechanism plan instead of trying
  to encode that landing path in the Phase 1 policy docs

## Decision Model

Apply review findings in this order:

1. Separate infrastructure failures from substantive review findings.
2. Check whether the finding is real, applicable, and actionable against checked-in sources.
3. If the finding is mistaken or non-applicable, reject it with evidence.
4. If the finding is actionable and in-scope for the submitted slice, fix it now.
5. If the finding is real but outside the task-sized slice, defer it only as a stop-and-replan outcome with checked-in follow-up.

Key implication:
- `defer_with_follow_up` is not a merge-through waiver while the runner still reports blocking `findings`

## Boundaries

Phase 1 is allowed to modify only doc surfaces:
- `docs/reviews/review-gate-quality-policy.md`
- `docs/goose/pr-workflow.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`

Phase 1 must not:
- add a JSON decision artifact
- add fingerprint or matcher logic
- invent new runner statuses
- imply trusted bootstrap or fail-closed behavior changed
- widen into `src/`, `scripts/`, `tests/`, or `.githooks/`

## Review Gate Decision Log

For future execution branches that use this policy, the checked-in implementation plan doc is the canonical place to record:
- finding fingerprint or exact file/line reference
- review command and scope
- disposition
- in-scope basis
- rationale
- follow-up artifact or owner

This log is workflow guidance layered on top of the unchanged runner contract.

## Lessons From The Failed Branch

- do not combine policy productization with runner/schema enforcement
- do not respond to every new finding by widening the current branch
- if a finding would require mechanism work, stop the branch and open a separate plan
- keep the first useful slice small enough that a human can audit its boundaries quickly

## Trigger For Phase 2

Only open a separate mechanism plan when real review-cycle evidence shows that the docs-only policy cannot classify or contain a recurring case cleanly.

That evidence should include:
- exact review command and scope
- exit code
- finding fingerprint or exact file/line reference
- attempted Phase 1 disposition
- why the policy could not resolve the case without widening scope
- whether the blocker is a first-blocked-push case that cannot be solved
  without hook or runner changes
