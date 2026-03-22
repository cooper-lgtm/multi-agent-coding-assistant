# Local Codex Exec Goose Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current GitHub-hosted Codex PR review gate in the goose plan runner with the repository-local `codex exec` review gate added by PR21, while keeping required-check polling and fail-closed merge behavior.

**Architecture:** Keep the existing split between orchestration logic and shell adapters. `src/automation/plan-runner.ts` should continue to own the retry/merge state machine, while `scripts/run-plan-doc.mjs` should swap from GitHub review polling to a local review adapter that returns structured findings from `scripts/run-local-codex-review.mjs`. Required checks remain GitHub-backed; only the review gate moves local.

**Tech Stack:** TypeScript, Node.js shell adapters, `gh`, `goose`, local `codex exec`, repository docs/tests.

---

## Background

PR21 established a repository-local strict review gate at `npm run review:local` and proved that the local `codex exec` path can return clean/finding/failure outcomes with fail-closed validation.

The goose automation path is still using GitHub-hosted Codex review as its repair-loop signal:
- `scripts/run-plan-doc.mjs` polls required checks through `gh pr checks`
- `scripts/run-plan-doc.mjs` polls online Codex review/comments through `gh api`
- `src/automation/plan-runner.ts` decides whether to merge, retry with `prior_review`, fail, or stop in `manual_review_required`

This means the repository now has:
- a working local strict review gate
- a separate goose PR controller that still depends on online review comments

PR22 should connect those two halves.

## Goal

Make the goose task loop trust the local `codex exec` review gate as its primary review signal, so the task loop becomes:

1. goose completes one task-sized implementation slice
2. required GitHub checks pass
3. local `codex exec` review runs on the task diff
4. findings flow back into goose as `prior_review`
5. merge only happens after a clean local review

## Non-goals

- Replace GitHub required checks with local checks
- Remove the GitHub-hosted Codex workflow from the repository
- Redesign the goose recipe beyond what is needed for local review handoff
- Expand the current plan runner into a multi-PR orchestration system
- Refactor unrelated test infrastructure

## Constraints

- `main-orchestrator` / plan-runner state ownership must stay explicit
- `needs_fix`, `failed`, and `manual_review_required` semantics must remain distinct
- Local review must stay fail-closed on schema/process/path/range issues
- The reviewed diff scope must match the task branch / PR semantics closely enough that repair loops are trustworthy
- Do not silently trust mutable branch-local review policy assets for same-repo self-review
- Keep `prior_review` machine-readable so goose can apply fixes deterministically

## Planning / Runtime Contract Check

- Current review-state contract lives in `src/automation/plan-runner.ts` and expects `pending`, `clean`, `findings`, or `timed_out`
- Current local review script is a CLI gate; it exits `0`/`1`/`2`, prints findings for humans, and validates structured `codex exec` output internally
- The goose recipe already accepts `prior_review` JSON and can use it on retries
- Existing tests already lock many fail-closed behaviors for:
  - local review bootstrap and payload validation
  - plan-runner review polling and retry semantics
  - run-plan-doc required-check and review-gate shell behavior
- This follow-up is an extension, not a redesign: it swaps the review source while preserving the outer task state machine

## Acceptance Criteria

- [ ] goose / plan-runner can consume local review results without scraping GitHub review comments
- [ ] local review findings are passed back into goose as `prior_review`
- [ ] a clean local review is required before merge
- [ ] local review timeout or execution failure produces `manual_review_required`, not a false clean result
- [ ] required GitHub checks continue to gate merge before local review runs
- [ ] docs explain the new control flow and the role of optional online review
- [ ] focused tests cover the local review adapter path and the revised repair loop

## Affected Modules

- `scripts/run-local-codex-review.mjs`
- `scripts/run-plan-doc.mjs`
- `src/automation/plan-runner.ts`
- `.goose/recipes/execute-next-plan-task.yaml`
- `tests/local-codex-review.test.mjs`
- `tests/plan-runner.test.mjs`
- `tests/run-plan-doc.test.mjs`
- `README.md`
- `docs/goose/pr-workflow.md`

## Risks

- Local review scope may drift from PR scope if the selected diff base is wrong
- A local review API shape that is too CLI-oriented will make the runner brittle
- Timeout semantics may diverge between standalone local review and plan-runner integration
- Repair-loop findings may lose enough path/line fidelity that goose cannot fix them reliably
- Optional online Codex review could create confusing duplicate signals if docs are vague

## Validation Steps

- `npm run build`
- `node --test tests/local-codex-review.test.mjs`
- `node --test tests/plan-runner.test.mjs`
- `node --test tests/run-plan-doc.test.mjs`
- `git diff --check`
- one local dry run of the review adapter on a non-trivial branch diff
- one end-to-end goose task dry run with fake dependencies before any live merge run

## Deliverables

- local review adapter output contract for machine consumption
- plan-runner integration changes
- updated goose task-loop docs
- regression tests for the local-review-backed repair loop
- validation evidence and remaining risks

### Task 1: Define the machine-readable local review adapter

**Files:**
- Modify: `scripts/run-local-codex-review.mjs`
- Test: `tests/local-codex-review.test.mjs`
- Doc: `README.md`

Steps:
1. Add a machine-readable mode to the local review runner so callers can receive structured status and findings instead of only exit code plus plain-text output.
2. Keep the current CLI gate behavior intact for human use.
3. Ensure the machine-readable mode preserves fail-closed semantics for invalid payloads, bad file ranges, timeout, and process failure.
4. Add tests that prove the adapter can distinguish `clean`, `findings`, and `failed/timed_out` outcomes without scraping stdout.

### Task 2: Replace online review polling with local review invocation

**Files:**
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `src/automation/plan-runner.ts`
- Test: `tests/plan-runner.test.mjs`
- Test: `tests/run-plan-doc.test.mjs`

Steps:
1. Add a dependency path in `run-plan-doc` that invokes the local review adapter after required checks pass.
2. Preserve `plan-runner` as the owner of retry/merge/manual-review decisions.
3. Remove the GitHub review-comment dependency from the critical path while leaving required-check polling intact.
4. Keep the returned finding shape aligned with `prior_review`.
5. Update tests so the state machine is proven against the new local review source.

### Task 3: Align diff scope with task-branch semantics

**Files:**
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `scripts/run-local-codex-review.mjs`
- Test: `tests/run-plan-doc.test.mjs`
- Test: `tests/local-codex-review.test.mjs`

Steps:
1. Decide the canonical local review scope for goose task PRs.
2. Ensure that scope reviews the task branch against its merge base with untracked worktree safety when appropriate.
3. Document how this scope differs from `npm run review:local` for uncommitted ad hoc developer checks.
4. Add regression tests so the selected scope cannot silently drift.

### Task 4: Define timeout and repair-loop semantics

**Files:**
- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Test: `tests/plan-runner.test.mjs`
- Test: `tests/run-plan-doc.test.mjs`
- Doc: `docs/goose/pr-workflow.md`

Steps:
1. Keep required checks before local review.
2. Map local review timeout or execution failure to `manual_review_required`.
3. Map local review findings to `needs_fix` style retry through `prior_review`.
4. Decide whether local clean review needs the same debounce logic as GitHub-hosted delayed comments, and simplify if that online-only concern no longer applies.

### Task 5: Update workflow docs and operator guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/reviews/strict-codex-review-rubric.md` if needed

Steps:
1. Document the new source of truth for goose review decisions.
2. Clarify that GitHub-hosted Codex review becomes optional comparison/signal rather than merge-blocking truth.
3. Record the expected operator commands for local dry runs and live runs.
4. Call out remaining gaps if a fully autonomous goose self-loop is still not complete after PR22.
