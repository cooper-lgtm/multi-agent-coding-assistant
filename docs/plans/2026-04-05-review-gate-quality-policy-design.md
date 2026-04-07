# Review-Gate Quality Policy Design

**Status:** Proposed

**Related Plan:** `docs/plans/2026-04-05-review-gate-quality-policy.md`

## Background

The repository already has a fail-closed local review gate with trusted
same-repo bootstrap behavior, but it does not yet have a stable checked-in
policy for deciding:
- which findings must be fixed in the current PR
- which findings may be rejected with evidence
- which findings may be deferred into follow-up work
- when Goose must stop rather than widen the branch

The abandoned `review-convergence-gate` branch showed the failure mode clearly:
policy and mechanism were changed together, and the branch expanded into runner,
schema, prompt, docs, and tests.

## Decision

Start with a docs-only, policy-first Phase 1.

Phase 1 defines the decision model and stop rules without changing:
- `scripts/run-local-codex-review.mjs`
- `scripts/lib/local-codex-review-adapter.mjs`
- prompt or schema files
- hooks
- tests

## Decision Model

Apply review findings in this order:

1. Separate infrastructure failures from substantive review findings.
2. Check whether the finding is real, applicable, and actionable against
   checked-in sources.
3. If the finding is mistaken or non-applicable, reject it with evidence.
4. If the finding is actionable and in-scope for the submitted slice, fix it
   now.
5. If the finding is real but outside the task-sized slice, defer it only as a
   stop-and-replan outcome with checked-in follow-up.

Key implications:
- `defer_with_follow_up` is not a merge-through waiver while the runner still
  reports blocking `findings`
- `manual_review_required` is a fail-closed infrastructure outcome, not an
  author-level review disposition
- any first-blocked-push exception remains mechanism work and is out of scope
  for Phase 1

## Boundaries

Phase 1 future execution work is allowed to modify only these doc surfaces:
- `docs/reviews/review-gate-quality-policy.md`
- `docs/goose/pr-workflow.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`
- `docs/plans/2026-04-05-review-gate-quality-policy.md`

Phase 1 must not:
- add a JSON decision artifact
- add fingerprint or matcher logic
- invent new runner statuses
- imply trusted bootstrap or fail-closed behavior changed
- widen into `src/`, `scripts/`, `tests/`, `.githooks/`, prompts, or schemas

## Unimplemented Follow-Up

The repository may still need a narrow mechanism for first-blocked-push false
positives, but that path is not part of Phase 1.

Reason:
- the unchanged local pre-push gate still blocks pushes on returned `findings`
- a docs-only policy branch cannot make a reliable first-blocked-push escape
  hatch real without widening into hook, runner, or other mechanism work

Phase 1 rule:
- if a docs-only review-gate policy branch would need a first-blocked-push
  exception to land, stop and open a separate mechanism plan instead of trying
  to encode that landing path in the Phase 1 policy docs

## Review Loop Stop Rule

For a single PR and a single topic of repeated review feedback:
- after 3 review-loop rounds, continue fixing only `P0`, `P1`, or mechanical
  merge blockers
- record lower-priority follow-up work separately instead of continuing to grow
  the current branch

This stop rule exists to keep planning and execution branches reviewable and to
avoid endless wording churn.

## Trigger For Phase 2

Only open a separate mechanism plan when real review-cycle evidence shows that
the docs-only policy cannot classify or contain a recurring case cleanly.

That evidence should include:
- exact review command and scope
- exit code
- finding fingerprint or exact file or line reference
- attempted Phase 1 disposition
- why the policy could not resolve the case without widening scope
- whether the blocker is a first-blocked-push case that cannot be solved
  without hook or runner changes
