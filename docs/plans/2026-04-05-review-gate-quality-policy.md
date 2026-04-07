# Review-Gate Quality Policy Implementation Plan

**Design Doc:** `docs/plans/2026-04-05-review-gate-quality-policy-design.md`

**Goal:** Define a strict but bounded review-gate quality policy for a future
docs-only Phase 1 execution slice without widening into runner, schema, prompt,
or hook mechanism work.

**Architecture:** Productize policy before mechanism. The planning PR only
defines the policy and the future execution boundaries. The later execution PR
creates the policy doc and aligns the workflow/template/review docs. Any
first-blocked-push exception remains separate mechanism work.

**Tech Stack:** Markdown docs and existing review workflow artifacts

---

## RALPLAN Summary

### Principles

1. Preserve trusted bootstrap and fail-closed review behavior in the first
   slice.
2. Productize policy before adding any new decision mechanism.
3. Keep planning and execution as separate PR-sized slices.
4. Stop when review starts requiring mechanism work instead of continuing to
   widen docs-only branches.
5. Cap repetitive review churn: after 3 rounds on one topic, continue only on
   `P0`, `P1`, or mechanical merge blockers.

### Decision Drivers

1. The review gate already has strict statuses and trusted-bootstrap behavior;
   Phase 1 should not destabilize them.
2. The failed convergence branch proved the scope risk: policy plus mechanism in
   one branch causes runaway review churn.
3. Multiple stacked execution attempts showed that first-blocked-push and
   publication-deadlock cases are mechanism-shaped, not docs-only wording work.

### Viable Options

#### Option A: Planning docs first, execution later

**Approach:** Land a clean planning baseline first, then open a separate
docs-only execution PR from that merged baseline.

**Pros:**
- smallest review surface at each step
- separates planning churn from execution churn
- keeps mechanism work out of the docs-only phase

**Cons:**
- requires two PRs instead of one

#### Option B: Planning and execution in one PR

**Approach:** Put the planning docs and the future execution docs in one branch.

**Pros:**
- one merge path

**Cons:**
- larger review surface
- higher chance of repeated consistency findings
- harder to tell whether a blocker belongs to planning or execution

### Recommended Direction

Choose Option A.

First land a clean planning baseline. Then create a fresh execution branch from
the merged `main`.

## Background

The repository already has a strict local review gate:
- `prompts/review-agent-codex-exec.md` defines the finding threshold and
  priority labels
- `docs/reviews/strict-codex-review-rubric.md` defines the current local-review
  quality bar
- `scripts/run-local-codex-review.mjs` and
  `scripts/lib/local-codex-review-adapter.mjs` preserve the fail-closed
  `manual_review_required` path and same-repo trusted bootstrap behavior
- `docs/goose/pr-workflow.md` treats blocking local review as part of the
  PR-sized Goose loop

What is missing is a productized policy for convergence:
- which findings must be fixed in the current PR
- which findings may be rejected as non-actionable
- which findings may be deferred into explicit follow-up work
- when Goose must stop instead of widening the branch

## Goal

Create a compact, execution-ready planning baseline for a future docs-only Phase
1 execution slice.

## Non-goals

- add new runner statuses or alter `clean`, `findings`, or
  `manual_review_required`
- change trusted same-repo bootstrap behavior
- change fail-closed local review semantics
- add a checked-in decision artifact, fingerprinting, or matcher logic
- update prompts or output schemas in this planning branch
- make Goose automatically accept or defer findings
- solve first-blocked-push publication deadlocks in this branch

## Constraints

- preserve trusted bootstrap and fail-closed review semantics
- separate policy productization from mechanism changes
- keep the planning branch reviewable as one small PR
- use durable repo docs instead of chat-only guidance
- stop instead of widening when review points to hook, runner, prompt, or schema
  work
- after 3 review-loop rounds on the same topic, continue only on `P0`, `P1`, or
  mechanical merge blockers

## Out-Of-Scope Mechanism Note

The repository may still need a narrow review-gate-stabilization exception for
first-blocked-push cases, but that is not part of this planning PR.

Why it stays out of scope:
- the unchanged local pre-push gate still blocks pushes on returned `findings`
- making a reliable exception path executable would require hook, runner, or
  other mechanism work
- this branch must not widen into those surfaces

Planning-branch rule:
- if the policy would need a first-blocked-push exception to land, stop and
  open a separate mechanism plan instead of trying to encode that landing path
  here

## Planning / Runtime Contract Check

This planning branch is doc-only.

Relevant current contracts and workflow surfaces:
- `prompts/review-agent-codex-exec.md` defines actionable-finding threshold plus
  priority labels
- `docs/reviews/strict-codex-review-rubric.md` defines strict local-review
  expectations and fail-closed infrastructure handling
- `scripts/run-local-codex-review.mjs` owns trusted same-repo bootstrap and
  structured local review execution
- `scripts/lib/local-codex-review-adapter.mjs` normalizes `clean`, `findings`,
  and `manual_review_required`
- `docs/goose/pr-workflow.md` documents the blocking local review gate and
  PR-sized workflow

This branch aligns planning docs to those contracts. It does not extend them.

## Proposed Policy Baseline

The later execution slice should document an applicability-first decision model:

1. Separate infrastructure stop conditions from substantive review findings.
2. Check whether the finding is real, applicable, and actionable against the
   current code, tests, schemas, docs, and checked-in design sources.
3. Only after that applicability check, use priority plus task scope to decide
   whether the finding must be fixed now or may be deferred.

It should document this decision table as repository policy:

| Finding class | Current PR expectation | Notes |
| --- | --- | --- |
| `manual_review_required` or other local-review infrastructure failure | must stop; do not merge | never treat as accepted or deferred author work |
| any finding shown to be mistaken, non-actionable, or not applicable to actual code or checked-in design sources | may reject with evidence and rationale | rejection is evidence-backed, not silent suppression |
| actionable `P0` within the submitted slice | must fix now | never defer |
| actionable `P1` within the submitted slice | must fix now | never defer |
| actionable `P2` that breaks the task goal, acceptance criteria, trusted bootstrap, fail-closed behavior, or runtime invariants | must fix now | do not defer invariant-breaking findings |
| real `P2` outside the task-sized slice | may defer with checked-in follow-up and rationale | current PR must remain correct and bounded |
| real `P3` outside the task-sized slice | may defer with checked-in follow-up and rationale | lower urgency than `P2`, same boundary rule |
| lower-priority actionable finding still inside the declared slice | should fix now | deferral is not a way to avoid finishing the current slice |

Required documentation behavior for rejected or deferred findings in the future
execution branch:
- record the rationale in a checked-in `Review Gate Decision Log` inside the
  task branch's implementation plan doc
- include the finding fingerprint or exact file or line reference, the review
  command or scope, the disposition, the in-scope basis, the rationale, and the
  follow-up artifact or owner when deferring
- for rejections, cite the evidence used to show the finding is mistaken or
  non-applicable
- keep the gate blocking by default; the policy documents what humans should do,
  not what the runner auto-waives

Deferral rule:
- `defer_with_follow_up` is a stop-and-replan outcome, not a merge-through
  waiver
- it does not authorize pushing or merging through unresolved local-review
  findings while the runner still reports `findings`
- creating a separate follow-up plan does not by itself make the current branch
  mergeable while the unresolved deferred finding still belongs to the submitted
  scope

## Acceptance Criteria

- [ ] this planning branch remains docs-only and touches only the two planning
      docs named below
- [ ] the planning baseline explicitly keeps first-blocked-push exception work
      out of scope
- [ ] the planning baseline separates infrastructure stop conditions from
      substantive review findings
- [ ] the planning baseline defines a future execution slice that is limited to
      five owned docs
- [ ] the planning baseline records the 3-round review-loop stop rule
- [ ] validation for this planning branch references only files that exist in
      this branch

## Affected Modules

### Current planning branch only

- Create: `docs/plans/2026-04-05-review-gate-quality-policy-design.md`
- Create: `docs/plans/2026-04-05-review-gate-quality-policy.md`

### Future execution branch only

- Create: `docs/reviews/review-gate-quality-policy.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `docs/plans/2026-04-05-review-gate-quality-policy.md`

### Explicitly out of scope

- `scripts/run-local-codex-review.mjs`
- `scripts/lib/local-codex-review-adapter.mjs`
- `prompts/review-agent-codex-exec.md`
- `prompts/review-agent-output-schema.json`
- `tests/local-codex-review*.mjs`
- `tests/run-plan-doc.test.mjs`
- any new `docs/reviews/local-review-decisions*` artifact

## Risks

- even a cleaner planning baseline may still leave execution branches exposed to
  mechanism-shaped review blockers
- execution work may still need a mechanism follow-up before it can merge
- review churn can still recur if the later execution branch blurs planning,
  execution, and mechanism scope again

## Review Gate Decision Log

For future execution branches that apply this policy, the canonical decision
home is the checked-in implementation plan doc for that branch.

Minimum log fields:
- finding fingerprint or exact file or line reference
- review command and scope
- disposition: `fix_now`, `reject_with_evidence`, or `defer_with_follow_up`
- in-scope basis
- rationale
- follow-up artifact or owner when the disposition is `defer_with_follow_up`

If the review process itself fails closed, record that separately as an
infrastructure stop condition instead of treating `manual_review_required` as an
author-level disposition.

## Validation Plan

Planning-branch validation is doc-only. Validate with:
- `git diff --check`
- `git diff --name-only origin/main...HEAD`
- `git rev-parse --verify origin/main >/dev/null`
- `if git diff --name-only origin/main...HEAD | rg -v '^(docs/plans/2026-04-05-review-gate-quality-policy-design\\.md|docs/plans/2026-04-05-review-gate-quality-policy\\.md)$'; then echo "Out-of-scope tracked file changes detected" && exit 1; fi`

Do not reuse this planning-branch validation command for the future execution
branch.

## Deliverables

- a checked-in design doc for review-gate quality policy
- a checked-in implementation plan for the future docs-only execution slice
- an explicit out-of-scope statement for first-blocked-push mechanism work
- a 3-round review-loop stop rule for future branches

## ADR

### Decision

Adopt a policy-first, docs-only planning baseline as a separate PR before any
future execution work.

### Drivers

- preserve trusted bootstrap and fail-closed local review behavior
- avoid repeating the scope blowup from the failed convergence branch
- keep first-blocked-push mechanism work explicitly separate from docs-only
  policy work

### Alternatives considered

- Option A: planning docs first, execution later
- Option B: planning and execution in one PR

### Why chosen

Option A is the only choice that keeps planning review small and prevents
execution churn from polluting the planning baseline.

### Consequences

- one extra PR step before the future execution slice
- a cleaner planning baseline in `main`
- mechanism follow-up stays explicit instead of leaking into docs-only work

### Follow-ups

1. Merge this planning baseline PR.
2. Open a future docs-only execution PR from the merged `main`.
3. If execution still hits first-blocked-push / false-positive publication
   blockers, open a separate mechanism plan or issue.

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

For the future execution PR:
- prefer a single task-sized execution branch because the work is docs-only and
  wording drift is the main risk

For a future mechanism follow-up:
- treat it as a separate planning and implementation lane, not part of Phase 1
  docs-only work

### Launch Hints

- merge this planning PR before opening the execution PR
- start the execution PR from fresh `main`, not from any old stacked execution
  branch

### Team Verification Path

For this planning branch:
- `git diff --check`
- `git diff --name-only origin/main...HEAD`

For the future execution branch:
- verify only the five execution-owned docs change
- push early
- stop after 3 review-loop rounds unless the remaining issue is `P0`, `P1`, or
  a mechanical merge blocker

## Scope Boundaries And Stop Rules

### Scope boundaries

- this planning branch may modify only the two planning docs created here
- the future execution branch may modify only the five execution-owned docs
- no branch in this Phase 1 line may modify runner, hook, schema, prompt, or
  automation surfaces

### Stop rules

Stop the planning or execution branch immediately if a new review finding would
require:
- changing `scripts/run-local-codex-review.mjs`
- changing `scripts/lib/local-codex-review-adapter.mjs`
- changing review prompt or schema files
- adding a new checked-in JSON decision artifact
- inventing a new gate status or widening the meaning of `clean`

Review-loop stop rule:
- after 3 rounds on the same topic, continue only for `P0`, `P1`, or mechanical
  merge blockers
- record lower-priority follow-up work separately and stop expanding the current
  branch

## Task Breakdown

### Task 1: Land the planning baseline

**Files:**
- Create: `docs/plans/2026-04-05-review-gate-quality-policy-design.md`
- Create: `docs/plans/2026-04-05-review-gate-quality-policy.md`

**Test First:**
- Doc-only task; no behavior change.

**Implementation Notes:**
- keep the planning PR self-contained
- do not reference future execution docs as if they already exist in this branch
- keep first-blocked-push handling explicitly out of scope
- encode the 3-round review-loop stop rule directly in the plan

**Validation:**
- `git diff --check`
- `git diff --name-only origin/main...HEAD`
