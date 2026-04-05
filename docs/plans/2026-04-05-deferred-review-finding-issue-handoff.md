# Deferred Review Finding Issue Handoff Implementation Plan

**Design Doc:** `docs/plans/2026-04-05-deferred-review-finding-issue-handoff-design.md`

**Goal:** Define and later implement a durable issue-handoff workflow for confirmed review findings that require code changes but should not be fixed in the current PR, without weakening the existing fail-closed review gate.

**Architecture:** Keep the reviewer detector-only and make triage the owner of defer, carry-forward, resolution, and follow-up decisions. Use a repo-owned `deferred_fix_handoff` ledger as the canonical record and treat issues as projections only. Phase 1 is docs-only: it locks the record model, lifecycle, activation rule, and projection semantics before any runner or provider automation exists.

**Tech Stack:** Markdown docs, repository workflow policy, future triage/issue projection surfaces

---

## Background

The repository already has a strict review gate that distinguishes between
actionable findings and `manual_review_required` infrastructure failures.
What it does not have yet is a durable, agent-readable handoff contract for
findings that genuinely need follow-up changes outside the current PR.

Without that contract, the repository risks:

- treating “issue exists” as an accidental merge waiver
- opening stale follow-up work for pre-merge findings on superseded heads
- losing provenance once the finding leaves the original review context
- coupling follow-up tracking too tightly to Goose or GitHub

## Goal

Produce an execution-ready design and phased implementation plan for deferred
required review findings, with clear definitions, a canonical record model, an
issue projection model, and explicit lifecycle rules.

## Non-goals

- change the current blocking review gate in Phase 1
- introduce new review statuses beyond current gate outcomes
- let GitHub issues become the source of truth
- treat `manual_review_required` as a deferred code-fix case
- build provider-specific automation in the first slice

## Constraints

- preserve fail-closed review and merge semantics
- keep `review-agent` as evaluator only
- keep triage as the owner of defer and follow-up decisions
- keep the canonical contract review-system agnostic
- keep the first implementation slice docs-only and reviewable
- avoid using `fingerprint` as identity

## Planning / Runtime Contract Check

This plan intentionally starts outside the runner/runtime implementation path.

Current repository rules already constrain the design:

- `docs/reviews/strict-codex-review-rubric.md` defines findings as actionable
  issues introduced by the reviewed diff and keeps `manual_review_required`
  outside the finding payload.
- `docs/goose/pr-workflow.md` keeps blocking review findings as merge-blocking.
- `ARCHITECTURE.md` and `PRODUCT.md` keep evaluators and owners distinct.
- `docs/templates/task-template.md` already has an out-of-scope follow-up seam,
  but it is not yet a durable ledger model.

Phase 1 should document the target handoff contract without changing these
runtime or workflow rules.

## Canonical Record Model

Future implementation should create a repo-owned `deferred_fix_handoff`
ledger/artifact. The canonical entry is minted by triage at the first canonical
write, not by the reviewer and not by issue creation.

Minimum canonical fields:

- `ledger_entry_id`
- `status`
- `origin_phase`
- `head_context`
- `raw_provenance`
- `deferred_fix_handoff`
- optional `fingerprint` metadata

`fingerprint` is a dedupe/search hint only.

## Lifecycle Rules

Canonical statuses:

- `provisional`
- `confirmed`
- `carried_forward`
- `resolved`
- `discarded`

Head/merge semantics:

- `pre_merge_current_head` may only enter as `provisional`
- `post_merge` may promote to `confirmed`
- `superseded_head` must be explicitly `carried_forward` or `discarded`

Activation rule:

- durable follow-up work activates only after `post_merge` or explicit
  carry-forward triage
- `pre_merge_current_head` alone never activates durable follow-up work

## Projection Rules

Issues are projections, not canonical state.

Projection actions:

- `create`
- `update`
- `close`
- `reopen`
- `no-op`

Reconciliation must be keyed by `ledger_entry_id`, not by `fingerprint`.

## Acceptance Criteria

- [ ] Phase 1 docs define the canonical ledger and explicitly state that issues
      are projections only
- [ ] Phase 1 docs define `ledger_entry_id`, minimum raw provenance, and the
      minimum `deferred_fix_handoff` payload
- [ ] Phase 1 docs define the lifecycle states, owner semantics, and allowed
      transitions
- [ ] Phase 1 docs define exact `pre_merge_current_head`, `post_merge`, and
      `superseded_head` handling
- [ ] Phase 1 docs define projection reconciliation with idempotent
      `create/update/close/reopen/no-op` behavior
- [ ] Phase 1 docs explicitly exclude `manual_review_required` from the
      deferred code-fix lane
- [ ] Phase 1 docs include worked examples for provisional discard,
      post-merge confirm, explicit carry-forward, resolve, reopen, and
      `manual_review_required` exclusion
- [ ] Phase 1 implementation does not change runner, hook, merge, or review
      status behavior

## Affected Modules

### Phase 1 only

- Create: `docs/plans/2026-04-05-deferred-review-finding-issue-handoff-design.md`
- Create: `docs/plans/2026-04-05-deferred-review-finding-issue-handoff.md`

### Likely future Phase 1 execution docs

- Create: `docs/reviews/deferred-fix-handoff.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`

### Explicitly out of scope for this PR

- `scripts/run-local-codex-review.mjs`
- `scripts/run-plan-doc.mjs`
- `.githooks/*`
- `src/automation/*`
- `src/schemas/*`
- `tests/*`

## Risks

- a canonical ledger adds governance overhead if triage discipline is weak
- pre-merge findings can still create stale intent unless carry-forward rules
  stay strict
- future implementation may over-couple to GitHub if projections are mistaken
  for canonical state
- `ledger_entry_id` minting must be explicit in the written docs so identity is
  not confused with provisional detection

## Validation Plan

This PR is docs-only. Validate with:

- `npm run build`
- `git diff --check`

When Phase 1 docs are later executed, also validate the written spec against:

- worked example walkthroughs
- lifecycle table checks
- projection reconciliation examples

## Deliverables

- one checked-in design doc
- one checked-in implementation plan
- ADR-level decision record for the handoff model
- future execution guidance for `ralph` and `team`

## ADR

### Decision

Adopt a canonical `deferred_fix_handoff` ledger with issue projections.

### Drivers

- preserve fail-closed review semantics
- keep follow-up tracking portable beyond Goose
- avoid stale or duplicate durable follow-up work on superseded heads

### Alternatives considered

- reviewer-owned defer decisions
- issue tracker as canonical store
- fingerprint as identity
- auto-activating pre-merge findings
- allowing `manual_review_required` into the deferred code-fix lane

### Why chosen

This is the smallest design that preserves correctness and recoverability
without prematurely coupling the system to Goose or GitHub.

### Consequences

- triage becomes the owner of canonical follow-up state
- issues no longer represent the source of truth
- future automation must reconcile projections back to the ledger

### Follow-ups

1. Execute the docs-only Phase 1 slice that writes the canonical handoff spec
   into repository workflow docs.
2. After that, decide whether to add a machine-readable ledger artifact.
3. Only then consider provider adapters that project ledger entries into issues.

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

For `ralph`:

- one `high` reasoning lane for the docs-only Phase 1 slice

For `team`:

- lane 1: canonical record model and lifecycle docs
- lane 2: projection/reconciliation docs and worked examples
- one verification lane for acceptance criteria and wording consistency

### Launch Hints

- Start with a docs-only branch.
- Do not open a runner or GitHub automation lane in the same slice.
- Keep `ledger_entry_id` minting explicit in the written Phase 1 docs.

### Team Verification Path

- confirm the design doc contains the canonical record model
- confirm the implementation plan contains acceptance criteria and phased work
- confirm `manual_review_required` stays excluded
- confirm issues are described as projections only
- confirm the PR contains no runtime or script changes

## Task Breakdown

### Task 1: Write the canonical handoff design into repository docs

**Files:**
- Create: `docs/reviews/deferred-fix-handoff.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`

**Test First:**
- Doc-only task; no behavior change.

**Implementation Notes:**
- define `ledger_entry_id`
- define minimum provenance and payload requirements
- define the lifecycle table and merge-state rules
- define issue projection as derived output only
- keep `manual_review_required` explicitly outside this lane

**Validation:**
- `git diff --check`

### Task 2: Add worked examples and projection reconciliation guidance

**Files:**
- Modify: `docs/reviews/deferred-fix-handoff.md`
- Modify: `docs/goose/pr-workflow.md`

**Test First:**
- Doc-only task; no behavior change.

**Implementation Notes:**
- add provisional discard example
- add post-merge confirmation example
- add explicit carry-forward example
- add resolve and reopen examples
- add idempotent reconciliation rules

**Validation:**
- `git diff --check`

### Task 3: Define the machine-readable ledger artifact contract

**Files:**
- Create: `docs/plans/<future-machine-readable-ledger-design>.md`
- Modify: `docs/reviews/deferred-fix-handoff.md`

**Test First:**
- Doc-first design task; no production behavior change in this slice.

**Implementation Notes:**
- specify where triage writes canonical records
- specify the artifact shape and lifecycle ownership
- do not add provider automation yet

**Validation:**
- `git diff --check`

### Task 4: Add provider projections only after the ledger is stable

**Files:**
- Modify: provider adapter and workflow surfaces only after a separate design is approved

**Test First:**
- Add focused adapter tests before provider automation.

**Implementation Notes:**
- create or update issue projections from canonical entries
- keep reconciliation keyed by `ledger_entry_id`
- do not allow issue existence to waive unresolved blocking findings

**Validation:**
- future focused adapter tests
- `git diff --check`
