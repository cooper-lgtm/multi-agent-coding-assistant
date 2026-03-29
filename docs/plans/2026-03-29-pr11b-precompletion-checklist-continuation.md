# PR11b Pre-Completion Checklist Continuation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an orchestrator-owned continuation loop that prevents implementation workers from handing unverified work to external quality gates.

**Architecture:** Build this slice on top of the `RuntimeMiddleware` seam introduced by PR35. If the target branch does not already contain `src/orchestrator/runtime-middleware.ts`, land PR35 first or retarget this plan onto the branch that does. The checklist middleware should read task `execution_guidance`, inspect worker verification evidence, and either allow the task to proceed to `test-agent` / `review-agent` or request `continue_task` with explicit feedback for the next implementation attempt.

**Tech Stack:** TypeScript, Node.js built-in test runner, orchestrator runtime loop, worker execution contracts, OpenClaw/goose implementation prompts, Markdown docs

---

## Background

PR10a/10b/10c made worker execution more grounded by adding `execution_guidance`, a runtime context builder, and worker payload threading. PR35 adds the narrow middleware seam needed to act on that context inside the runtime loop.

The remaining gap is behavioral: implementation workers can still return `implementation_done` after making code changes without showing that they ran the expected local verification loop. That creates false handoffs where external quality gates are forced to catch what should have been blocked earlier.

PR11b exists to turn the middleware seam into a real runtime guardrail.

## Goal

Make the orchestrator capable of:
- detecting when a worker stopped before required verification
- continuing the same task with structured checklist feedback
- preserving that feedback and attempt evidence for the next worker pass
- keeping final `completed` / `needs_fix` ownership with external quality gates

## Non-goals

- replacing the external `test-agent` / `review-agent` gates
- inventing a second scheduler or worker-owned retry loop
- widening planning ownership beyond implementation tasks
- introducing loop-detection heuristics or trace-analysis work from PR12 / PR13

## Constraints

- `main-orchestrator` remains the only global controller
- planning still outputs implementation tasks only
- `assigned_agent` remains limited to `frontend-agent` or `backend-agent`
- `test-agent` and `review-agent` remain post-implementation evaluators
- checklist continuation must not silently consume the final retry escalation on the first missed verification pass
- worker payloads and prompt guidance must stay compact and execution-focused

## Planning / Runtime Contract Check

- Current schemas already carry `execution_guidance` and worker execution evidence through the runtime path.
- PR35 introduces `before_dispatch`, `after_implementation_attempt`, and `before_quality_gates` middleware hooks plus `continue_task`.
- Current runtime tests already lock status transitions for success, `needs_fix`, `blocked`, and retry escalation.
- Prompt and goose task-contract changes are coupled to this slice because workers need to understand that missing verification means unfinished work.
- This task extends runtime behavior without changing planning ownership boundaries.

## Acceptance Criteria

- [ ] The implementation path can reject `implementation_done` when required verification evidence is missing.
- [ ] Checklist continuation feedback is persisted on the task and visible to the next worker attempt.
- [ ] External quality gates still make the final `completed` vs `needs_fix` decision after checklist requirements are satisfied.
- [ ] Prompt/task-contract guidance matches the runtime continuation behavior.
- [ ] Focused middleware and runtime tests describe the new loop clearly.

## Affected Modules

- `src/orchestrator/runtime-middleware.ts`
- `src/orchestrator/pre-completion-checklist-middleware.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/orchestrator/reporting-manager.ts`
- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `src/adapters/goose-recipe-builder.ts`
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`
- `docs/goose/task-contract.md`
- `tests/orchestrator-middleware.test.mjs`
- `tests/orchestrator-precompletion-checklist.test.mjs`
- `tests/orchestrator-runtime.test.mjs`
- `tests/orchestrator-goose-runtime.test.mjs`

## Risks

- checklist logic could become too strict and block valid handoffs
- continuation bookkeeping could accidentally consume retry budget incorrectly
- prompts could drift from runtime behavior and cause worker confusion
- reporting could hide whether the task was continued by middleware or by retry policy

## Validation Steps

- `git diff --check`
- `npm run build`
- `node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-precompletion-checklist.test.mjs`
- `node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

## Deliverables

- new checklist middleware
- task/runtime contract updates for continuation feedback
- prompt and goose task-contract updates for self-verification
- focused middleware/runtime test coverage
- README or contract notes only where behavior changed

---

### Task 1: Confirm the runtime middleware dependency and lock the runtime seam

**Files:**
- Verify: `src/orchestrator/runtime-middleware.ts`
- Verify: `src/orchestrator/main-orchestrator.ts`
- Verify: `tests/orchestrator-middleware.test.mjs`
- Modify if needed: `docs/plans/2026-03-23-runtime-success-breakdown.md`

**Step 1: Verify the middleware seam exists on the target branch**

Run:
`test -f src/orchestrator/runtime-middleware.ts`

Expected:
success when PR35 is present; failure means this slice must be retargeted after PR35 lands.

**Step 2: Sanity-check current middleware behavior**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs`

Expected:
PASS with hook-order and continuation-budget behavior already covered.

**Step 3: Record dependency notes if needed**

If the target branch was missing PR35, update this plan or branch notes so downstream work starts from the correct base.

**Step 4: Commit**

Run:
`git add docs/plans/2026-03-29-pr11b-precompletion-checklist-continuation.md`

`git commit -m "docs: add PR11b checklist continuation plan"`

### Task 2: Add checklist continuation contracts and middleware behavior

**Files:**
- Create: `src/orchestrator/pre-completion-checklist-middleware.ts`
- Create: `tests/orchestrator-precompletion-checklist.test.mjs`
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing checklist test**

Cover at minimum:
- worker returns `implementation_done` without required verification evidence
- middleware requests `continue_task` before external quality gates
- continuation message is persisted on task state and carried into the next attempt
- verified implementation proceeds to quality gates normally

**Step 2: Run the test to confirm the gap**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs`

Expected:
FAIL because no checklist middleware exists yet.

**Step 3: Implement the minimal checklist behavior**

Implement:
- rules keyed from `task.execution_guidance.verification_commands`
- continuation feedback storage on the task / worker retry handoff
- visible runtime events for continuation requests
- fail-closed behavior only after repeated ignored checklist requirements, not on the first miss

**Step 4: Re-run focused middleware tests**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-precompletion-checklist.test.mjs`

Expected:
PASS with deterministic continuation behavior.

**Step 5: Commit**

Run:
`git add src/orchestrator/pre-completion-checklist-middleware.ts tests/orchestrator-precompletion-checklist.test.mjs src/workers/contracts.ts src/schemas/runtime.ts src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/index.ts`

`git commit -m "feat: add pre-completion checklist continuation"`

### Task 3: Align worker prompts and goose task contract with checklist enforcement

**Files:**
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`
- Modify: `docs/goose/task-contract.md`
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `tests/goose-recipe-builder.test.mjs`

**Step 1: Tighten prompt and task-contract expectations**

Require implementation workers to:
- treat verification as part of task completion
- return explicit verification evidence
- treat missing verification as unfinished work, not a valid handoff

**Step 2: Run focused adapter/contract checks**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
FAIL until prompts and goose task-contract text align with runtime expectations.

**Step 3: Update prompt and packaging surfaces**

Adjust prompt/task-contract wording and any recipe-builder assertions so the worker-facing protocol matches the middleware behavior exactly.

**Step 4: Re-run the focused checks**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
PASS with self-verification expectations aligned end to end.

**Step 5: Commit**

Run:
`git add prompts/frontend-agent.md prompts/backend-agent.md docs/goose/task-contract.md src/adapters/goose-recipe-builder.ts tests/goose-recipe-builder.test.mjs`

`git commit -m "docs: align worker protocol with checklist continuation"`

### Task 4: Extend end-to-end runtime coverage and note the new behavior

**Files:**
- Modify: `tests/orchestrator-runtime.test.mjs`
- Modify: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `README.md`

**Step 1: Add failing end-to-end cases**

Cover scenarios where:
- a worker stops early and gets continued by checklist middleware
- the next worker attempt satisfies the checklist and reaches quality gates
- external quality gates still decide final completion

**Step 2: Run the runtime suites to confirm they fail first**

Run:
`npm run build && node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
FAIL until the continuation loop is fully wired.

**Step 3: Finish integration notes**

Adjust runtime behavior and README notes so the documented flow matches the actual handoff order:
implementation attempt -> checklist gate -> external quality gates.

**Step 4: Run the focused verification set**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
PASS with continuation behavior visible in both mock and goose-backed runtime coverage.

**Step 5: Commit**

Run:
`git add tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs README.md`

`git commit -m "test: cover checklist continuation flow"`
