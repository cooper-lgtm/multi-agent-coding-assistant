# First-Blocked-Push Review-Gate Mechanism Implementation Plan

**Design Doc:** `docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism-design.md`

**Goal:** Plan a narrowly scoped mechanism branch that resolves first-blocked-push
false positives and deferrals under the blocking local review gate without
turning that path into a broad bypass.

**Architecture:** Keep policy and mechanism separate. This planning branch
documents the mechanism scope, responsibilities, and validation targets. A later
implementation branch will touch hook and runner surfaces only after this plan
is reviewed.

**Tech Stack:** Markdown docs, local review hook workflow, local review runner,
and repository Git workflow

---

## RALPLAN Summary

### Principles

1. Preserve fail-closed behavior for infrastructure failures.
2. Keep normal in-scope findings blocking by default.
3. Add the smallest trusted mechanism that unblocks first-push deadlocks.
4. Require a durable audit trail for any exceptional path.
5. Stop review-loop churn after 3 rounds unless the remaining issue is `P0`,
   `P1`, or a mechanical merge blocker.

### Decision Drivers

1. The current blocking hook creates dead ends for false positives and real
   out-of-scope findings on first push.
2. The docs-only policy baseline deliberately leaves this problem out of scope.
3. The implementation branch will likely need to touch trusted mechanism
   surfaces, so it must be planned explicitly.

### Viable Options

#### Option A: Maintainer-owned trusted publication path

**Approach:** Keep the normal author push path blocking; add a maintainer-backed
path that can publish and record reviewed exceptions.

**Pros:**
- strongest trust boundary
- smallest semantic change to current workflow

**Cons:**
- maintainer involvement required

#### Option B: Author-submitted artifact with trusted replay

**Approach:** Let authors prepare a constrained artifact that the runner accepts
on a later attempt.

**Pros:**
- smoother author ergonomics

**Cons:**
- more trust and abuse complexity

### Recommended Direction

Choose **Option A** first.

## Background

The merged planning baseline now clearly says:
- first-blocked-push exception work is out of scope for docs-only policy
- `reject_with_evidence` and `defer_with_follow_up` are valid review outcomes
- `manual_review_required` is an infrastructure stop condition

What remains unsolved is the publication mechanism for branches that cannot
publish their own evidence or follow-up before the blocking local gate fires.

## Goal

Produce a reviewable implementation plan for a future mechanism branch.

## Non-goals

- implement the mechanism in this branch
- revise the docs-only Phase 1 execution policy again
- weaken blocking behavior for normal findings
- solve unrelated CI or GitHub review workflows

## Constraints

- any implementation branch may need to touch `.githooks/`,
  `scripts/run-local-codex-review.mjs`, and
  `scripts/lib/local-codex-review-adapter.mjs`
- mechanism work must not become a general bypass for review findings
- infra failures must remain fail-closed
- after 3 review-loop rounds on this planning topic, continue only on `P0`,
  `P1`, or mechanical merge blockers

## Planning / Runtime Contract Check

This branch is planning-only.

Relevant current contracts:
- the pre-push hook blocks on returned findings
- the runner distinguishes `clean`, `findings`, and `manual_review_required`
- the merged planning baseline in `docs/plans/2026-04-05-review-gate-quality-policy*.md`
  keeps first-blocked-push mechanism work out of scope for docs-only policy

This branch defines the future implementation scope. It does not modify hook or
runner behavior.

## Acceptance Criteria

- [ ] the plan names the likely mechanism surfaces explicitly
- [ ] the plan separates author, maintainer, and runner responsibilities
- [ ] the plan defines how false positives and out-of-scope findings get durable
      review records
- [ ] the plan keeps `manual_review_required` fail-closed
- [ ] the plan states how the mechanism avoids becoming a general bypass
- [ ] the branch remains limited to the two planning docs below

## Affected Modules

### Current planning branch only

- Create: `docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism-design.md`
- Create: `docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism.md`

### Future mechanism implementation branch candidates

- `.githooks/`
- `scripts/run-local-codex-review.mjs`
- `scripts/lib/local-codex-review-adapter.mjs`
- supporting docs as needed

## Risks

- over-designing a complex trust model before trying the smallest maintainer
  path
- under-specifying audit requirements and reintroducing ambiguity later
- accidentally broadening the mechanism into a general review bypass

## Validation Plan

Planning-branch validation is doc-only. Validate with:
- `git diff --check`
- `git diff --name-only origin/main...HEAD`
- `if git diff --name-only origin/main...HEAD | rg -v '^(docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism-design\\.md|docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism\\.md)$'; then echo "Out-of-scope tracked file changes detected" && exit 1; fi`

## Deliverables

- a checked-in mechanism design doc
- a checked-in implementation plan for the future mechanism branch
- explicit boundaries for future hook and runner work

## ADR

### Decision

Plan a dedicated first-blocked-push mechanism branch before any further docs-only
execution work continues.

### Drivers

- docs-only execution work has already reached a mechanism boundary
- planning and execution churn dropped once the clean planning baseline replaced
  the old stacked chain
- the next useful step is a mechanism plan, not more docs-only execution churn

### Alternatives considered

- Option A: maintainer-owned trusted publication path
- Option B: author-submitted artifact with trusted replay

### Why chosen

Option A is the smallest trustworthy first implementation direction.

### Consequences

- one more planning PR before implementation
- clearer mechanism scope
- cleaner separation between policy docs and trusted publication mechanics

### Follow-ups

1. Merge this mechanism planning PR.
2. Open a dedicated mechanism implementation branch.
3. Revisit docs-only execution work only after the mechanism branch defines a
   clear outcome or explicit non-goal.

## Scope Boundaries And Stop Rules

### Scope boundaries

- this branch may modify only the two planning docs listed above
- do not implement hook, runner, or schema changes here

### Stop rules

Stop this branch if review demands:
- actual hook or runner implementation in the planning PR
- unrelated docs cleanup outside these two files
- policy rewrites that belong back in the merged planning baseline

Review-loop stop rule:
- after 3 rounds on the same topic, continue only for `P0`, `P1`, or mechanical
  merge blockers
- record lower-priority follow-up work separately and stop expanding the branch
