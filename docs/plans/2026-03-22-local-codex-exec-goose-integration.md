# Local Codex Exec Goose Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the GitHub-hosted Codex PR review gate in the Goose plan runner with the repository-local `codex exec` review path from PR21, while keeping required-check polling and fail-closed merge behavior.

**Architecture:** Keep required-check polling in `scripts/run-plan-doc.mjs`, but replace GitHub review polling with a direct local review gate backed by a shared machine-readable adapter. `src/automation/plan-runner.ts` should continue to own merge, retry, and `manual_review_required` decisions, but its review seam should move from "poll remote review state" to "run a task-scoped local review and normalize the result". Preserve the PR21 trusted-bootstrap and trusted-asset rules instead of bypassing them with a branch-local CLI stdout contract.

**Tech Stack:** TypeScript, Node.js shell adapters, `gh`, `goose`, local `codex exec`, repository docs/tests.

---

## Background

PR21 established a repository-local strict review gate at `npm run review:local` and proved that the local `codex exec` path can return clean, findings, and fail-closed infrastructure outcomes.

The Goose automation path is still using GitHub-hosted Codex review as its repair-loop signal:
- `scripts/run-plan-doc.mjs` polls required checks through `gh pr checks`
- `scripts/run-plan-doc.mjs` polls online Codex review/comments through `gh api`
- `src/automation/plan-runner.ts` decides whether to merge, retry with `prior_review`, fail, or stop in `manual_review_required`

This means the repository now has:
- a working local strict review gate with trusted bootstrap rules
- a separate Goose PR controller that still depends on online review comments

This follow-up should connect those two halves without weakening the PR21 safety properties.

## Goal

Make the Goose task loop trust the local `codex exec` review gate as its primary review signal, so the task loop becomes:

1. Goose completes one task-sized implementation slice
2. required GitHub checks pass
3. a task-scoped local `codex exec` review runs on the PR diff
4. findings flow back into Goose as `prior_review`
5. merge only happens after a clean local review

## Non-goals

- Replace GitHub required checks with local checks
- Remove the GitHub-hosted Codex workflow from the repository
- Redesign the Goose recipe beyond what is needed for local review handoff
- Expand the current plan runner into a multi-PR orchestration system
- Reuse the ad hoc developer `--uncommitted` review scope as the blocking PR gate

## Constraints

- `main-orchestrator` and plan-runner state ownership must stay explicit
- `needs_fix`, `failed`, and `manual_review_required` semantics must remain distinct
- Local review must stay fail-closed on schema, process, path, and range issues
- Same-repo self-review must continue to honor PR21 trusted-bootstrap and trusted-asset rules
- The blocking Goose review scope must match PR semantics closely enough that repair loops are reproducible
- The blocking Goose review scope must not silently widen to unrelated untracked worktree files
- `prior_review` must stay machine-readable so Goose can apply fixes deterministically

## Planning / Runtime Contract Check

- `src/automation/plan-runner.ts` currently expects a polled review-state contract shaped like `pending`, `clean`, `findings`, or `timed_out`
- `scripts/run-local-codex-review.mjs` is currently a human-facing CLI gate that exits `0`/`1`/`2`, prints findings for humans, and re-executes through a trusted same-repo bootstrap path before review logic starts
- `npm run review:local -- --base <branch>` intentionally includes tracked and untracked worktree state, which is correct for developer spot checks but too wide for a blocking Goose PR gate
- the Goose recipe already accepts `prior_review` JSON and can use it on retries
- existing tests already lock fail-closed behavior for:
  - local review bootstrap and payload validation
  - plan-runner review and retry semantics
  - run-plan-doc required-check and review-gate shell behavior
- this follow-up should preserve the outer task loop while changing the review seam from remote polling to a direct local execution result

## Acceptance Criteria

- [ ] Goose and plan-runner consume a machine-readable local review result without scraping GitHub review comments
- [ ] the machine-readable local review path preserves PR21 trusted-bootstrap and trusted-asset behavior for same-repo review
- [ ] local review findings are passed back into Goose as `prior_review`
- [ ] a clean local review is required before merge
- [ ] local review timeout or execution failure produces `manual_review_required`, not a false clean result
- [ ] required GitHub checks continue to gate merge before local review runs
- [ ] the blocking Goose review scope is pinned to PR/task diff semantics and does not include unrelated untracked worktree files
- [ ] docs explain the new control flow and the role of optional online review
- [ ] focused tests cover the shared adapter path and the revised repair loop

## Affected Modules

- Create: `scripts/lib/local-codex-review-adapter.mjs`
- Modify: `scripts/run-local-codex-review.mjs`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `src/automation/plan-runner.ts`
- Modify: `.goose/recipes/execute-next-plan-task.yaml`
- Create or modify: `tests/local-codex-review-adapter.test.mjs`
- Modify: `tests/local-codex-review.test.mjs`
- Modify: `tests/plan-runner.test.mjs`
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`

## Risks

- Local review scope may drift from PR scope if the selected base or head is wrong
- Reusing the human CLI runner as the only machine interface would make the integration brittle
- Same-repo bootstrap behavior may accidentally keep Goose on an older review interface if the shared adapter boundary is not explicit
- Timeout semantics may diverge between standalone local review and plan-runner integration
- Repair-loop findings may lose enough path or line fidelity that Goose cannot fix them reliably
- Optional online Codex review could create confusing duplicate signals if docs are vague

## Validation Steps

- `npm run build`
- `node --test tests/local-codex-review-adapter.test.mjs`
- `node --test tests/local-codex-review.test.mjs`
- `node --test tests/plan-runner.test.mjs`
- `node --test tests/run-plan-doc.test.mjs`
- `git diff --check`
- one local dry run of the shared review adapter against a non-trivial branch diff
- one fake-dependency end-to-end Goose task dry run
- one disposable-branch live run that proves findings reroute through `prior_review` before any real merge automation is trusted

## Deliverables

- shared machine-readable local review adapter
- local-review-backed plan-runner integration changes
- updated Goose task-loop docs
- regression tests for the local-review-backed repair loop
- validation evidence and remaining risks

### Task 1: Extract a shared machine-readable local review adapter

**Files:**
- Create: `scripts/lib/local-codex-review-adapter.mjs`
- Modify: `scripts/run-local-codex-review.mjs`
- Create or modify: `tests/local-codex-review-adapter.test.mjs`
- Modify: `tests/local-codex-review.test.mjs`

Steps:
1. Extract the task-scoped local review execution and normalization logic into a shared adapter module that returns a typed result such as `clean`, `findings`, or `manual_review_required`, plus findings and failure notes.
2. Keep `scripts/run-local-codex-review.mjs` as the human-facing wrapper that prints findings and maps adapter results to exit codes.
3. Preserve the PR21 trusted same-repo bootstrap and trusted prompt/schema asset loading in the shared path instead of adding a branch-local stdout protocol that only the wrapper understands.
4. Add focused tests that prove the shared adapter and the CLI wrapper both preserve fail-closed semantics for invalid payloads, bad file ranges, timeout, and process failure.

### Task 2: Replace GitHub review polling with a direct local review gate

**Files:**
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `src/automation/plan-runner.ts`
- Modify: `tests/plan-runner.test.mjs`
- Modify: `tests/run-plan-doc.test.mjs`

Steps:
1. Replace the current review dependency in `plan-runner` with a direct local-review invocation result instead of polling `getCodexReviewState({ prUrl, headSha })`.
2. Keep required-check polling exactly where it is today.
3. Remove `gh api .../reviews` and `gh api .../comments` from the blocking repair-loop path.
4. Map local review outcomes to existing plan-runner decisions:
   - `clean` -> merge
   - `findings` -> rerun the same task with `prior_review`
   - infrastructure failure or timeout -> `manual_review_required`
5. Delete or isolate GitHub-review debounce logic that only existed to handle delayed online comments; do not carry that complexity into the local synchronous review path.

### Task 3: Pin the Goose review scope to PR semantics

**Files:**
- Modify: `scripts/lib/local-codex-review-adapter.mjs`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `tests/local-codex-review-adapter.test.mjs`
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `README.md`

Steps:
1. Define the canonical Goose review scope as the task branch diff from merge-base to the current PR head, using the task's changed files and branch metadata when available.
2. Do not include unrelated untracked worktree files in the blocking Goose gate.
3. Document clearly how this PR-scoped gate differs from `npm run review:local` in developer `--uncommitted` mode.
4. Add regression tests so the Goose gate cannot silently drift back to a wider worktree review scope.

### Task 4: Align timeout, retry, and repair-loop semantics

**Files:**
- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `.goose/recipes/execute-next-plan-task.yaml`
- Modify: `tests/plan-runner.test.mjs`
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `docs/goose/pr-workflow.md`

Steps:
1. Keep required checks ahead of local review.
2. Map local review timeout or execution failure to `manual_review_required`.
3. Map local review findings to a same-task retry through `prior_review`.
4. Keep the review feedback shape rich enough for deterministic repair, including file paths and bodies.
5. Verify that the new local path does not accidentally route review-tool failure back into author-fixable retry loops.

### Task 5: Update workflow docs and operator guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/reviews/strict-codex-review-rubric.md` if needed

Steps:
1. Document the new source of truth for Goose review decisions.
2. Clarify that GitHub-hosted Codex review becomes optional comparison or signal rather than merge-blocking truth.
3. Record the expected operator commands for fake dry runs and disposable live runs.
4. Call out any remaining gap between the Goose local-review loop and future orchestrator quality-gate reuse.
