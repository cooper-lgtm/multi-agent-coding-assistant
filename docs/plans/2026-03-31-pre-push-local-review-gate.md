# Pre-Push Local Review Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the blocking Codex review gate to the local pre-push stage so branch pushes only happen after a clean local review, while remote automation waits only on required GitHub checks before auto-merge.

**Architecture:** Reuse the existing local review runner as the single review authority and call it before every branch push in both human and automated flows. `src/automation/plan-runner.ts` should stop treating review as a post-checks gate; the repo-managed pre-push hook becomes the only blocking review gate, Goose repairs pre-push findings inside the same task run, and the outer runner waits only on required checks before merge.

**Tech Stack:** TypeScript, Node.js scripts, Git hooks, `gh`, `goose`, local `codex exec`, repository docs/tests.

---

## Background

PR30 already replaces GitHub-hosted Codex review polling with a local machine-readable review runner inside the plan-runner path. That closes the old GitHub review dependency, but it still keeps two runtime gates in sequence:
- local review after push and after required checks
- required GitHub checks before merge

The desired workflow is narrower:
- local review before push
- no push when findings exist
- required GitHub checks after push
- auto-merge once checks pass

The current PR30 branch also has two concrete issues:
- `docs/goose/pr-workflow.md` breaks markdown lint
- `scripts/run-plan-doc.mjs` always passes `--task-hint`, but trusted bootstrap capability detection in `scripts/run-local-codex-review.mjs` does not verify support for that flag

## Goal

Make local review the single blocking review gate by moving it to pre-push for both humans and automation, then auto-merge after required checks pass.

## Non-goals

- Replace GitHub required checks with local-only checks
- Remove the local machine-readable review runner
- Change the planning/runtime ownership model outside the plan-runner and hook surfaces
- Add a second review system in parallel with the local review gate

## Constraints

- Review findings must stay actionable in the same Goose run before a push can proceed
- Local review infrastructure failures must remain fail-closed
- `manual_review_required`, `failed`, and `blocked` semantics must stay distinct
- Human and automation push paths must use the same local review entry point
- Merge should happen only after required checks pass on the pushed PR head

## Planning / Runtime Contract Check

- `src/automation/plan-runner.ts` currently owns retry, check waiting, and merge sequencing
- `scripts/run-local-codex-review.mjs` and `scripts/lib/local-codex-review-adapter.mjs` already provide a machine-readable local review path
- `scripts/run-plan-doc.mjs` already has the shell seam needed to call local review
- PR30 docs currently document a post-checks local review gate, so docs must move with code
- existing tests in `tests/run-plan-doc.test.mjs` and `tests/local-codex-review.test.mjs` already cover the local review adapter and plan-runner flow, and should be extended rather than bypassed

## Acceptance Criteria

- [ ] human local pushes can use a repo-managed pre-push hook that runs the repository local review gate
- [ ] automation runs the same local review before push/open-or-update-PR instead of after required checks
- [ ] plan-runner waits only on required GitHub checks after a successful push
- [ ] plan-runner auto-merges after checks pass without a second review gate
- [ ] automation repairs pre-push local review findings before retrying the same push
- [ ] local review infrastructure failures still stop fail-closed
- [ ] `--task-hint` bootstrap capability mismatch is covered and fixed
- [ ] markdown lint passes for the updated workflow docs

## Affected Modules

- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `.goose/recipes/execute-next-plan-task.yaml`
- Modify: `scripts/run-local-codex-review.mjs`
- Modify: `scripts/lib/local-codex-review-adapter.mjs`
- Create: `.githooks/pre-push`
- Create: `scripts/install-git-hooks.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `tests/local-codex-review.test.mjs`

## Risks

- hook installation may be documented but not activated if `core.hooksPath` is not configured
- moving review earlier may require Goose recipe output to separate “review-clean and pushed” from “PR opened”
- pre-push review must not accidentally review unrelated untracked files in automation flows
- auto-merge must still act on the same head that passed required checks

## Validation Steps

- `node --test tests/local-codex-review.test.mjs`
- `node --test tests/run-plan-doc.test.mjs`
- `npm run lint:md`
- `npm run lint:js`
- `npm run build`
- `git diff --check`

## Deliverables

- code changes for the pre-push local review gate
- repo-managed git hook installation path
- updated tests
- updated workflow docs
- validation results and remaining risks

### Task 1: Lock the new gate behavior in tests

**Files:**
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `tests/local-codex-review.test.mjs`

Steps:
1. Add a failing test that expects plan-runner automation to call local review before push/open-or-update-PR rather than after required checks.
2. Add a failing test that proves trusted bootstrap capability detection must account for `--task-hint` when machine-readable head-range review requests include that flag.
3. Run the focused tests to confirm the new expectations fail for the current implementation.

### Task 2: Move automation review to pre-push and keep checks as the only remote gate

**Files:**
- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `.goose/recipes/execute-next-plan-task.yaml`
- Modify: `scripts/run-local-codex-review.mjs`
- Modify: `scripts/lib/local-codex-review-adapter.mjs`

Steps:
1. Update the plan-runner sequencing so the repo-managed pre-push review is the only blocking review gate before push/open-or-update-PR.
2. Remove the post-checks review wait from the plan-runner path so required checks become the only remote merge gate.
3. Fix trusted bootstrap capability detection so `--task-hint` is only used when the frozen trusted runner supports it, or omitted safely.
4. Run the focused tests and make them pass.

### Task 3: Add repo-managed pre-push wiring and update docs

**Files:**
- Create: `.githooks/pre-push`
- Create: `scripts/install-git-hooks.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`

Steps:
1. Add a repo-managed `pre-push` hook that runs the repository local review command and blocks pushes on findings or infrastructure failures.
2. Add a simple install command that sets `core.hooksPath` to the repo-managed hooks directory.
3. Update workflow docs to describe the single local pre-push review gate and remote checks-only auto-merge flow.
4. Fix the markdown lint issue in `docs/goose/pr-workflow.md`.
