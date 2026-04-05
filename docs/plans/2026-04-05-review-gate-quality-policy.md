# Review-Gate Quality Policy Implementation Plan

**Design Doc:** `docs/plans/2026-04-05-review-gate-quality-policy-design.md`

**Goal:** Define a strict but bounded review-gate quality policy that says which local-review findings must be fixed in the current PR, which may be explicitly rejected, and which may be deferred, without widening the first execution slice into new runner/schema/prompt machinery.

**Architecture:** Productize policy before mechanism. Phase 1 is a docs-only slice that clarifies the decision rules around the existing `clean` / `findings` / `manual_review_required` gate and records stop rules for Goose and humans. Any later enforcement change must be a separate branch after the policy is proven insufficient, and it must preserve trusted bootstrap plus fail-closed local review semantics.

**Tech Stack:** Markdown docs, existing local review workflow and prompt/rubric artifacts as references

---

## RALPLAN Summary

### Principles

1. Preserve trusted bootstrap and fail-closed review behavior in the first slice.
2. Productize policy before adding any new decision mechanism.
3. Keep the first slice PR-sized and docs-first so the branch cannot repeat the failed expansion.
4. Treat only durable repo artifacts as policy, not chat context or ad hoc PR comments.
5. Stop when the policy is clear enough to guide the next execution branch; do not solve future automation in the same change.

### Decision Drivers

1. The review gate already has strict statuses and trusted-bootstrap behavior; Phase 1 should not destabilize them.
2. The failed convergence branch proved the scope risk: `review-convergence-gate` diverged from `origin/main` by 13 files and about 2,022 inserted lines across runner, docs, schema, and test surfaces.
3. Goose needs explicit stop rules so new review findings do not turn one policy PR into an open-ended convergence mechanism project.

### Viable Options

#### Option A: Docs-first policy productization only

**Approach:** Add a checked-in policy doc and small workflow/doc updates that define current-PR fix rules, allowable reject/defer cases, and stop rules, while leaving the local review runner untouched.

**Pros:**
- smallest valuable slice
- preserves current trusted bootstrap and `manual_review_required` behavior
- gives future PRs a durable standard without inventing new statuses or artifacts
- turns the failed branch's lessons into repo guidance immediately

**Cons:**
- acceptance and deferral remain human-applied rather than machine-enforced
- reviewers may still disagree on edge cases until the policy sees real usage

#### Option B: Narrow runner mechanism in the same effort

**Approach:** Add a minimal runner-level way to recognize accepted or deferred findings, while trying to avoid the full decision-artifact system from the failed branch.

**Pros:**
- reduces repeated human interpretation sooner
- could shorten same-PR repair loops if the policy is stable enough

**Cons:**
- immediately touches trusted-bootstrap, runner, adapter, and regression-test surfaces
- still needs a durable checked-in artifact or prompt/schema contract to explain decisions
- likely reopens the same scope path that already exploded

#### Option C: Full convergence artifact and decision schema now

**Approach:** revive the failed branch direction: checked-in decision artifact, new schema, matcher/fingerprint logic, runner integration, and broader regression expansion.

**Pros:**
- most automated end state
- explicit durable record of accepted or deferred findings

**Cons:**
- already demonstrated poor slice discipline in this repo
- expands across policy, runner logic, bootstrap trust behavior, tests, and docs at once
- too large for the current task and too risky for Phase 1

### Recommended Direction

Choose Option A.

The first execution branch should be docs-only and should define the decision policy around the existing gate, not extend the gate itself. That gets the repository a durable rule set quickly, keeps the branch reviewable, and avoids reopening trusted-bootstrap and fail-closed semantics before the policy has even been exercised.

## Background

The repository already has a strict local review gate:
- `prompts/review-agent-codex-exec.md` defines the finding threshold and `P0`-`P3` priority labels.
- `docs/reviews/strict-codex-review-rubric.md` defines the current local-review quality bar.
- `scripts/run-local-codex-review.mjs` and `scripts/lib/local-codex-review-adapter.mjs` preserve the fail-closed `manual_review_required` path and same-repo trusted bootstrap behavior.
- `docs/goose/pr-workflow.md` treats blocking local review as part of the PR-sized Goose loop.

What is missing is a productized policy for convergence:
- which findings must be fixed in the current PR
- which findings may be rejected as non-actionable
- which findings may be deferred into explicit follow-up work
- when Goose must stop instead of widening the branch

The failed `review-convergence-gate` branch shows why this needs tighter scope. It attempted policy plus mechanism together and grew into runner, schema, docs, and test changes in one branch.

## Goal

Create a compact, execution-ready plan for a first implementation slice that documents review-gate quality policy without changing the local review mechanism.

## Non-goals

- add new runner statuses or alter `clean` / `findings` / `manual_review_required`
- change trusted same-repo bootstrap behavior
- change fail-closed local review semantics
- add a checked-in decision artifact, decision schema, fingerprinting, or matcher logic
- update the review prompt or output schema in Phase 1
- make Goose automatically accept or defer findings in Phase 1

## Constraints

- preserve trusted bootstrap and fail-closed review semantics
- separate policy productization from mechanism changes
- keep the first slice reviewable as one small PR
- use durable repo docs instead of chat-only guidance
- new findings against the policy branch must not justify widening into runner or schema work

## Planning / Runtime Contract Check

This plan's recommended Phase 1 is doc-only.

Relevant current contracts and workflow surfaces:
- `prompts/review-agent-codex-exec.md` already defines actionable-finding threshold plus priority labels.
- `docs/reviews/strict-codex-review-rubric.md` already defines strict local-review expectations and fail-closed infrastructure handling.
- `scripts/run-local-codex-review.mjs` already owns trusted same-repo bootstrap and structured local review execution.
- `scripts/lib/local-codex-review-adapter.mjs` already normalizes `clean`, `findings`, and `manual_review_required`.
- `docs/goose/pr-workflow.md` already documents the blocking local review gate and one-task-sized-PR workflow.

Phase 1 should align policy docs to those existing contracts, not extend them.

## Proposed Policy Baseline

Phase 1 should document an applicability-first decision model:

1. Separate infrastructure stop conditions from substantive review findings.
2. Check whether the finding is real, applicable, and actionable against the current code, tests, schemas, docs, and checked-in design sources such as acceptance criteria, architecture docs, or the task plan.
3. Only after that applicability check, use priority plus task scope to decide whether the finding must be fixed now or may be deferred.

Phase 1 should document this decision table as repository policy:

| Finding class | Current PR expectation | Notes |
| --- | --- | --- |
| `manual_review_required` or other local-review infrastructure failure | must stop; do not merge | never treat as accepted or deferred author work |
| any finding shown to be mistaken, non-actionable, or not applicable to the actual code or checked-in design sources | may reject with evidence and rationale | this includes mislabeled `P0`/`P1` cases; rejection is evidence-backed, not silent suppression |
| actionable `P0` within the submitted slice | must fix now | cannot defer; if the slice is too broad, narrow the slice and rerun review rather than treating the issue as deferred |
| actionable `P1` within the submitted slice | must fix now | cannot defer; if the slice is too broad, narrow the slice and rerun review rather than treating the issue as deferred |
| actionable `P2` that violates current task goal, acceptance criteria, trusted bootstrap, fail-closed behavior, or existing runtime invariants | must fix now | do not defer invariant-breaking findings |
| `P2` that is real but outside the task-sized slice | may defer with checked-in follow-up and rationale | only if current PR remains correct and bounded |
| `P3` that is real but outside the task-sized slice | may defer with checked-in follow-up and rationale | same rule as `P2`, lower urgency |
| actionable finding below the defer threshold but still in-scope for the declared slice | should fix now | the policy should not use deferral to avoid finishing the current slice correctly |

Required documentation behavior for rejected or deferred findings in Phase 1:
- record the rationale in a checked-in `Review Gate Decision Log` inside the task branch's implementation plan doc
- include the finding fingerprint or exact file/line reference, the review command/scope, the disposition, the in-scope basis, the rationale, and the follow-up artifact or owner
- for rejections, cite the evidence used to show the finding is mistaken or non-applicable
- for deferrals, point to a durable follow-up location created or named in the same PR
- keep the gate blocking by default; the policy documents what humans should do, not what the runner auto-waives

Phase 1 deferral is a branch-stop governance outcome, not a merge-through waiver:
- `defer_with_follow_up` means stop widening the current branch, log the decision, and replan or open follow-up work on a new branch/session
- it does not authorize pushing or merging through unresolved local-review findings while the runner still reports `findings`
- the current branch may continue only after the slice is narrowed enough that the deferred issue is no longer part of the submitted scope, or after a separate follow-up plan is prepared

## Acceptance Criteria

- [ ] the plan produces a docs-only Phase 1 with no runner, schema, prompt, hook, or test edits
- [ ] the policy explicitly defines which findings must be fixed now versus may be rejected or deferred
- [ ] the policy explicitly states that applicability is checked before priority determines fix-now versus defer
- [ ] the policy explicitly states that actionable `P0`/`P1` are never acceptable deferrals, while mistaken or non-applicable `P0`/`P1` may be rejected with evidence
- [ ] the policy records how a deferral or rejection must be documented in checked-in repo artifacts
- [ ] the policy separates infrastructure stop conditions from substantive review findings
- [ ] the policy explicitly states that deferral in Phase 1 is a stop-and-replan outcome, not a merge-through waiver against an unchanged blocking runner
- [ ] workflow docs say when Goose must stop instead of widening the branch
- [ ] the plan records the failed branch as a scope anti-pattern so future work does not repeat it

## Affected Modules

### Phase 1 only

- Create: `docs/reviews/review-gate-quality-policy.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `docs/plans/2026-04-05-review-gate-quality-policy.md`

### Explicitly out of scope for Phase 1

- `scripts/run-local-codex-review.mjs`
- `scripts/lib/local-codex-review-adapter.mjs`
- `prompts/review-agent-codex-exec.md`
- `prompts/review-agent-output-schema.json`
- `tests/local-codex-review*.mjs`
- `tests/run-plan-doc.test.mjs`
- any new `docs/reviews/local-review-decisions*` artifact

## Risks

- policy-only guidance may not remove all reviewer disagreement on the first try
- a later enforcement branch may still be needed if the same deferral/rejection dispute repeats
- policy wording can accidentally imply new gate behavior unless the docs stay explicit about what is and is not automated

## Review Gate Decision Log

For future execution branches that apply this policy, the canonical decision home is the checked-in implementation plan doc for that branch.

Applicability boundary:
- required for Goose-managed or otherwise non-trivial task branches that already use a checked-in implementation plan doc
- not a new requirement for every branch in the repository

Minimum log fields:
- finding fingerprint or exact file/line reference
- review command and scope
- disposition: `fix_now`, `reject_with_evidence`, `defer_with_follow_up`, or `manual_review_required`
- in-scope basis
- rationale
- follow-up artifact or owner

These are workflow dispositions layered on top of the unchanged runner contract. They are not new runner statuses and do not authorize pushing or merging through unresolved local-review findings.

Infrastructure recovery lane:
- `manual_review_required` means repair, rerun, or escalate the review process
- it is not an author-level reject/defer classification and should never be written up as if the code review itself had been settled

## Validation Plan

Phase 1 is doc-only. Validate with:
- `rg -n "Review Gate Decision Log|fix_now|reject_with_evidence|defer_with_follow_up|manual_review_required" docs/goose/pr-workflow.md docs/templates/task-template.md docs/reviews/recurring-issues.md docs/reviews/review-gate-quality-policy.md docs/plans/2026-04-05-review-gate-quality-policy.md`
- `git diff --name-only origin/main...HEAD`
- `git diff --name-only origin/main...HEAD | rg '^(src/|scripts/|tests/|\\.githooks/)'`
- `npm run lint:md`
- `git diff --check`

If the execution branch updates only the new policy doc plus the named workflow/review/template docs above, stop there.

## Deliverables

- a checked-in `docs/reviews/review-gate-quality-policy.md`
- small workflow/review doc updates that reference the new policy
- explicit stop rules for Goose and reviewers
- a short follow-up note identifying whether a separate mechanism branch is still needed after policy rollout

## ADR

### Decision

Adopt a policy-first, docs-only Phase 1 for review-gate quality decisions.

### Drivers

- preserve trusted bootstrap and fail-closed local review behavior
- avoid repeating the 13-file, 2,022-line scope blowup from the failed convergence branch
- give Goose a bounded, checked-in decision policy before considering mechanism changes

### Alternatives considered

- Option A: docs-first policy productization only
- Option B: narrow runner mechanism in the same effort
- Option C: full convergence artifact and decision schema now

### Why chosen

Option A is the only choice that improves decision clarity now without reopening runner/bootstrap/prompt/schema scope in the same branch.

### Consequences

- Phase 1 improves policy clarity immediately, but human judgment still applies reject/defer decisions
- real evidence from future review cycles may still justify a later mechanism plan
- the execution branch must keep wording aligned with the unchanged blocking runner contract

### Follow-ups

1. Execute the docs-only Phase 1 slice on a new branch after this plan is reviewed.
2. Only consider Phase 2 mechanism work after collecting real review-cycle evidence that Phase 1 cannot classify or contain cleanly.

## Execution Handoff

### Available Agent Types

- `main-orchestrator`
- `planning-agent`
- `architecture-planner`
- `engineering-planner`
- `integration-planner`
- `frontend-agent`
- `backend-agent`
- `test-agent`
- `review-agent`

### Recommended Staffing

For Goose:
- prefer a single task-sized execution branch for Phase 1 because the work is docs-only and wording drift is the main risk

For `ralph`:
- one primary lane at `high` reasoning to update the policy/workflow/template docs and keep the diff bounded
- finish with one verification pass over the bounded-doc validation commands before handoff

For `team`:
- at most two workers
- lane 1: policy doc plus decision-log wording
- lane 2: workflow/template/recurring-issues alignment
- one final verifier pass to confirm no `src/`, `scripts/`, `tests/`, or `.githooks/` files changed

### Launch Hints

- Prefer Goose for the actual Phase 1 execution because it already runs one task-sized PR at a time.
- If using `team`, split only by doc surface; do not open a runner/schema lane in the same execution round.

### Team Verification Path

- `rg -n "Review Gate Decision Log|fix_now|reject_with_evidence|defer_with_follow_up|manual_review_required" docs/goose/pr-workflow.md docs/templates/task-template.md docs/reviews/recurring-issues.md docs/reviews/review-gate-quality-policy.md docs/plans/2026-04-05-review-gate-quality-policy.md`
- `git diff --name-only origin/main...HEAD`
- `git diff --name-only origin/main...HEAD | rg '^(src/|scripts/|tests/|\\.githooks/)'`
- `npm run lint:md`
- `git diff --check`

## Scope Boundaries And Stop Rules

### Scope boundaries

- Phase 1 may only productize policy in docs.
- Phase 1 may not modify runner/bootstrap logic, JSON schemas, prompt wording, or machine-readable output.
- Phase 1 may not add a new decision artifact, fingerprinting, matcher logic, or automatic waiver flow.
- Phase 1 may not add or broaden regression suites beyond doc validation.
- Phase 1 workflow dispositions are guidance for humans and Goose operators; they are not new runner states.
- Phase 1 may not imply that deferred findings are mergeable while the unchanged runner still reports blocking `findings`.

### Stop rules

Stop the first execution branch immediately if any new review finding would require:
- changing `scripts/run-local-codex-review.mjs`
- changing `scripts/lib/local-codex-review-adapter.mjs`
- changing review prompt or schema files
- adding a new checked-in JSON decision artifact
- inventing a new gate status or widening the meaning of `clean`

When that happens:
- capture the blocker under `Out Of Scope Follow-ups`
- record the attempted disposition in the checked-in `Review Gate Decision Log`
- leave the current branch docs-only
- open a separate narrowly scoped mechanism plan on a new branch/session instead of extending the same branch

## Task Breakdown

### Task 1: Productize the review-gate decision policy in docs

**Files:**
- Create: `docs/reviews/review-gate-quality-policy.md`
- Modify: `docs/plans/2026-04-05-review-gate-quality-policy.md`

**Test First:**
- Doc-only task; no behavior change.

**Implementation Notes:**
- define the applicability-first, then priority-and-scope decision table
- separate infrastructure stop conditions from substantive review findings
- state that actionable `P0`/`P1` in the submitted slice stop the PR until resolved, while mistaken or non-applicable high-priority findings are rejected with evidence rather than fixed
- state that deferral means stop and replan, not merge through
- require checked-in rationale and follow-up recording for any rejected or deferred finding
- record the failed `review-convergence-gate` branch as the anti-pattern this policy is avoiding

**Validation:**
- `npm run lint:md`
- `git diff --check`

### Task 2: Align Goose workflow guidance to the new policy

**Files:**
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`

**Test First:**
- Doc-only task; no behavior change.

**Implementation Notes:**
- update Goose guidance to say the first response to findings is fix-now when they are in-scope and blocking
- require exact governed file/module paths and exact named policy surfaces for policy-sensitive tasks in the task template
- add explicit stop rules for out-of-scope mechanism requests
- add a recurring-issues note that policy branches must not expand into runner/schema work without a separate plan

**Validation:**
- `npm run lint:md`
- `git diff --check`

## Out Of Scope Follow-ups

Only open one of these after the docs-only policy has been used in real review cycles:

1. a separate mechanism design for machine-readable reject/defer handling
2. a separate trust-boundary hardening plan if same-repo bootstrap handling becomes a proven blocker
3. a separate prompt/rubric adjustment plan if the current finding threshold still produces noisy `P2`/`P3` churn
