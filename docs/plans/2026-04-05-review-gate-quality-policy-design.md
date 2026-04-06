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

## Temporary Exception During Review-Gate Stabilization

Before the review-gate decision mechanism exists, the repository needs a narrow
transition rule for work that is explicitly building or stabilizing review-gate
policy itself.

### Transition Rule

Allow a temporary, explicit exception from the blocking local pre-push review
gate for a very small class of review-gate-stabilization PRs.

This exception exists only because the current gate still treats any returned
`findings` as a repair-now signal, which can force policy and follow-up-design
PRs to absorb unrelated fixes and grow beyond their declared slice.

### Eligibility

A PR may use this temporary exception only if all of the following are true:

- the PR exists to define, narrow, or document review-gate policy, defer rules,
  or deferred-finding handoff semantics
- the PR does not change runtime implementation, review runner logic, hook
  logic, schema enforcement, or provider automation
- the PR does not use the exception to merge code that would otherwise require
  same-PR correctness fixes
- the PR keeps a tightly bounded, reviewable scope and explicitly names the
  transition-rule dependency in its plan or PR description

Examples that may qualify:
- a docs-only PR that defines when `reject_with_evidence` or
  `defer_with_follow_up` is legitimate
- a docs-only PR that defines the canonical deferred-finding handoff model

Examples that do not qualify:
- any PR that modifies `scripts/run-local-codex-review.mjs`
- any PR that modifies `scripts/lib/local-codex-review-adapter.mjs`
- any PR that modifies `.githooks/`
- any PR that modifies `src/` runtime behavior, schemas, or issue automation
- any PR that mixes policy docs with unrelated product or feature work

### Compensating Controls

A PR using this exception must instead satisfy all of the following controls:

- explicit statement in the checked-in implementation plan that the PR is using
  the temporary review-gate-stabilization exception
- explicit statement in the PR description that the local pre-push review gate
  was not used as a blocking approval signal for this PR
- bounded file scope declared up front
- no unrelated cleanup or opportunistic fixes
- normal non-review validation still runs for the touched surface
- human review remains mandatory before merge

This exception is not a waiver of review quality.
It is only a temporary waiver of the current pre-push gate as the blocking
mechanism for a narrow class of gate-stabilization PRs.

### Sunset Condition

This exception expires once the repository lands a mechanism that can classify
review findings into `fix_now`, `reject_with_evidence`, and
`defer_with_follow_up` without forcing every finding into the same same-PR
repair loop.

Once that mechanism exists, future PRs must use the normal blocking local review
path again unless a new, separately approved policy supersedes this transition
rule.

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
