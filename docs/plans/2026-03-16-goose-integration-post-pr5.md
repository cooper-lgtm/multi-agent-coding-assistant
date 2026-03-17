# Goose Integration Post-PR5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the mock implementation worker bridge with a goose-backed execution runtime, keep quality gates in the orchestrator, and complete the remaining PR6-PR9 roadmap through goose-driven PR-sized delivery.

**Architecture:** Keep planning, DAG construction, retry/escalation, persistence, and independent `test-agent` / `review-agent` gates in the TypeScript orchestrator. Add a goose-backed implementation adapter under the existing worker seam so `frontend-agent` and `backend-agent` tasks execute through goose recipes, return structured execution evidence, and hand back candidate results for external quality-gate approval.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing orchestrator/runtime modules, Goose CLI and recipes, local filesystem state, GitHub CLI

---

## Manual Preconditions Before Execution

These items are intentionally outside goose's first implementation PR. Complete them before starting Task 1.

1. Merge PR5 so goose starts from a clean, stable baseline.
2. Add the root harness files you want goose to follow:
   - `PRODUCT.md`
   - `ARCHITECTURE.md`
   - `AGENTS.md`
3. Ensure goose can execute inside the repository with the required credentials:
   - provider credentials available locally
   - `gh auth status` succeeds
   - `goose --version` succeeds
4. Decide the initial provider/model mapping for implementation roles:
   - `frontend-agent`
   - `backend-agent`
5. Decide the delivery rule:
   - one roadmap slice per branch
   - one branch per PR
   - Codex review is triggered automatically by workflow for every PR
   - merge only after the listed local verification commands pass

If any prerequisite is missing, goose should stop and report `blocked` instead of improvising.

### Task 1: Add structured goose worker-result contracts

**Files:**
- Create: `tests/goose-worker-contract.test.mjs`
- Modify: `tests/openclaw-runtime-adapter.test.mjs`
- Modify: `tests/orchestrator-runtime.test.mjs`
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing contract tests**

Assert that implementation-worker results can carry:
- `commands_run`
- `test_results`
- `risk_notes`
- `suggested_status`
- goose session metadata such as branch, commit, or PR references when available

Also assert that:
- quality-gate worker outputs still remain independent of implementation outputs
- existing mock execution paths still compile even when the new fields are absent

**Step 2: Run tests to verify they fail**

Run:
- `npm run build && node --test tests/goose-worker-contract.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs`

Expected: FAIL because the current worker contract layer does not expose goose-specific execution evidence.

**Step 3: Write the minimal contract implementation**

Extend the shared worker contract types and runtime task records so implementation attempts can persist:
- commands executed
- structured test summaries
- risk notes
- suggested post-implementation state
- optional delivery metadata such as branch name, commit SHA, and PR URL

Do not move final completion ownership out of the orchestrator.

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/goose-worker-contract.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs`

Expected: PASS with richer implementation-worker evidence and no regression to the existing mock path.

**Step 5: Commit**

Run:
- `git add tests/goose-worker-contract.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs src/workers/contracts.ts src/schemas/runtime.ts src/adapters/openclaw-runtime-adapter.ts src/index.ts`
- `git commit -m "feat: add structured goose worker contracts"`

### Task 2: Add goose recipe assets and task-to-recipe mapping

**Files:**
- Create: `tests/goose-recipe-builder.test.mjs`
- Create: `src/adapters/goose-recipe-builder.ts`
- Create: `.goose/recipes/frontend-implementation.yaml`
- Create: `.goose/recipes/backend-implementation.yaml`
- Create: `.goose/recipes/shared/worker-output-schema.json`
- Create: `docs/goose/task-contract.md`
- Modify: `src/index.ts`

**Step 1: Write the failing recipe-builder test**

Assert that the builder can:
- map `frontend-agent` to the frontend goose recipe
- map `backend-agent` to the backend goose recipe
- inject repo path, task payload, retry context, and acceptance criteria
- require the structured output schema for the final goose response

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/goose-recipe-builder.test.mjs`

Expected: FAIL because there is no goose recipe mapping layer or recipe assets yet.

**Step 3: Write the minimal recipe assets and builder**

Create:
- one recipe for frontend implementation work
- one recipe for backend implementation work
- one shared structured-output schema
- one repo-local task contract document explaining what goose must return

The recipes should:
- reuse the repository harness instead of duplicating policy everywhere
- tell goose to explore the repository before editing
- require local verification before returning
- return only a candidate implementation result, not final global approval

**Step 4: Run test to verify it passes**

Run:
- `npm run build && node --test tests/goose-recipe-builder.test.mjs`

Expected: PASS with stable role-to-recipe selection and structured task packaging.

**Step 5: Commit**

Run:
- `git add tests/goose-recipe-builder.test.mjs src/adapters/goose-recipe-builder.ts .goose/recipes/frontend-implementation.yaml .goose/recipes/backend-implementation.yaml .goose/recipes/shared/worker-output-schema.json docs/goose/task-contract.md src/index.ts`
- `git commit -m "feat: add goose recipes and task mapping"`

### Task 3: Implement the goose worker adapter

**Files:**
- Create: `tests/goose-worker-adapter.test.mjs`
- Create: `src/adapters/goose-worker-adapter.ts`
- Create: `src/adapters/goose-process-runner.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing goose adapter test**

Assert that the adapter can:
- accept an `OpenClawWorkerRoleRequest`
- build the correct goose invocation for the selected recipe
- parse structured goose output into the implementation-worker result contract
- surface `blocked` cleanly when goose reports missing prerequisites or environment failures

Stub process execution in the test so no real goose command is needed yet.

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/goose-worker-adapter.test.mjs`

Expected: FAIL because no goose adapter exists.

**Step 3: Write the minimal goose adapter**

Implement:
- a small process runner that shells out to goose
- a worker adapter that converts role requests into goose recipe executions
- output normalization that validates the structured result before handing it back to the orchestrator

Treat malformed goose output as `failed` or `blocked` with evidence, not as implicit success.

**Step 4: Run test to verify it passes**

Run:
- `npm run build && node --test tests/goose-worker-adapter.test.mjs`

Expected: PASS with deterministic adapter behavior under stubbed process execution.

**Step 5: Commit**

Run:
- `git add tests/goose-worker-adapter.test.mjs src/adapters/goose-worker-adapter.ts src/adapters/goose-process-runner.ts src/index.ts`
- `git commit -m "feat: add goose worker adapter"`

### Task 4: Route implementation work through goose while keeping quality gates external

**Files:**
- Create: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `src/orchestrator/implementation-dispatcher.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Create: `src/examples/run-goose-worker-demo.ts`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write the failing orchestrator integration test**

Assert that:
- `frontend-agent` and `backend-agent` tasks can execute through the goose adapter
- `test-agent` and `review-agent` still run through the external quality-gate runner
- orchestrator retry logic can feed `needs_fix` feedback back into a later goose attempt
- persisted run state stores goose execution evidence for later inspection

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/orchestrator-goose-runtime.test.mjs tests/orchestrator-persistence.test.mjs`

Expected: FAIL because the dispatcher is still mock-only and persisted state does not yet carry goose execution metadata.

**Step 3: Write the minimal integration**

Add:
- a configurable implementation-dispatch path that can use goose
- run-reporting support for structured implementation evidence
- a small demo script such as `demo:goose`

Preserve the rule that external quality gates remain the final arbiter of `completed` vs `needs_fix`.

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/orchestrator-goose-runtime.test.mjs tests/orchestrator-persistence.test.mjs tests/orchestrator-runtime.test.mjs`

Expected: PASS with goose-backed implementation routing and unchanged external gate semantics.

**Step 5: Commit**

Run:
- `git add tests/orchestrator-goose-runtime.test.mjs src/orchestrator/implementation-dispatcher.ts src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/storage/run-store.ts src/storage/file-backed-run-store.ts src/examples/run-goose-worker-demo.ts package.json README.md`
- `git commit -m "feat: route implementation tasks through goose"`

### Task 5: Implement PR6 human approval and orchestration controls

**Files:**
- Create: `tests/orchestrator-approval-controls.test.mjs`
- Create: `src/orchestrator/approval-manager.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Modify: `README.md`

**Step 1: Write the failing approval-control test**

Assert that the runtime can:
- pause after planning and wait for explicit approval before execution
- support `auto-execute` and `confirm-before-run`
- persist approval state in stored run artifacts
- expose blocked / repeated-failure escalation paths clearly in summaries

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/orchestrator-approval-controls.test.mjs`

Expected: FAIL because approval-state orchestration does not exist yet.

**Step 3: Write the minimal implementation**

Add:
- approval-state representation on the runtime
- an approval manager or equivalent decision seam
- user-facing reporting that distinguishes waiting-for-approval from execution failure

Keep the implementation independent from goose so approval remains an orchestrator concern.

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/orchestrator-approval-controls.test.mjs tests/orchestrator-persistence.test.mjs`

Expected: PASS with durable approval controls.

**Step 5: Commit**

Run:
- `git add tests/orchestrator-approval-controls.test.mjs src/orchestrator/approval-manager.ts src/schemas/runtime.ts src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/storage/file-backed-run-store.ts README.md`
- `git commit -m "feat: add approval controls to orchestrator"`

### Task 6: Implement PR7 budget, policy, and safety controls

**Files:**
- Create: `tests/orchestrator-policy-engine.test.mjs`
- Create: `src/orchestrator/policy-engine.ts`
- Modify: `src/schemas/planning.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/retry-escalation-manager.ts`
- Modify: `src/adapters/model-router.ts`
- Modify: `README.md`

**Step 1: Write the failing policy-engine test**

Assert that the runtime can enforce:
- max parallelism
- role-specific model fallback policy
- per-task retry budget beyond a single fixed default
- risk-threshold-based escalation to manual review
- guardrails for expensive or high-risk execution paths

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/orchestrator-policy-engine.test.mjs tests/orchestrator-runtime.test.mjs`

Expected: FAIL because these controls are not centrally enforced yet.

**Step 3: Write the minimal implementation**

Add:
- a policy evaluation seam
- stronger budget enforcement in the orchestrator loop
- clearer interaction between risk, retry, and model-upgrade logic

Avoid pushing cost or approval policy down into goose recipes.

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/orchestrator-policy-engine.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected: PASS with policy decisions enforced above the goose execution layer.

**Step 5: Commit**

Run:
- `git add tests/orchestrator-policy-engine.test.mjs src/orchestrator/policy-engine.ts src/schemas/planning.ts src/schemas/runtime.ts src/orchestrator/main-orchestrator.ts src/orchestrator/retry-escalation-manager.ts src/adapters/model-router.ts README.md`
- `git commit -m "feat: add orchestration policy engine"`

### Task 7: Implement PR8 evaluation suite and golden scenarios

**Files:**
- Create: `tests/orchestrator-e2e.test.mjs`
- Create: `tests/fixtures/planning/direct-plan-golden.json`
- Create: `tests/fixtures/runtime/goose-needs-fix-golden.json`
- Create: `tests/fixtures/runtime/goose-blocked-golden.json`
- Create: `docs/evals/known-limitations.md`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write the failing end-to-end evaluation tests**

Assert that golden scenarios cover:
- happy-path completion
- goose implementation failure with retry recovery
- external review returning `needs_fix`
- blocked execution caused by missing repository prerequisites

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/orchestrator-e2e.test.mjs`

Expected: FAIL because the evaluation fixtures and scenarios do not exist yet.

**Step 3: Write the minimal eval harness**

Add:
- compact golden fixtures for planning and runtime summaries
- end-to-end scenario coverage that exercises the goose-backed path
- a short known-limitations note documenting what remains non-deterministic

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/orchestrator-e2e.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected: PASS with meaningful regression coverage.

**Step 5: Commit**

Run:
- `git add tests/orchestrator-e2e.test.mjs tests/fixtures/planning/direct-plan-golden.json tests/fixtures/runtime/goose-needs-fix-golden.json tests/fixtures/runtime/goose-blocked-golden.json docs/evals/known-limitations.md package.json README.md`
- `git commit -m "feat: add goose-backed evaluation scenarios"`

### Task 8: Implement PR9 CLI entry points and goose delivery workflow

**Files:**
- Create: `tests/cli-smoke.test.mjs`
- Create: `src/cli/main.ts`
- Create: `docs/goose/pr-workflow.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/index.ts`

**Step 1: Write the failing CLI smoke test**

Assert that the repository exposes stable entry points such as:
- `plan`
- `run`
- `resume`

Also assert support for:
- `--repo-path`
- `--planning-mode`
- `--execution-runtime=mock|goose`
- `--output=json`

**Step 2: Run test to verify it fails**

Run:
- `npm run build && node --test tests/cli-smoke.test.mjs`

Expected: FAIL because no productized CLI entry exists yet.

**Step 3: Write the minimal CLI and workflow docs**

Add:
- a small CLI entry point
- package scripts or `bin` metadata
- docs describing the standard goose delivery loop:
  - create branch
  - implement task
  - run local verification
  - `gh pr create`
  - rely on the automatic Codex review workflow
  - merge only after the required checks pass

The CLI should expose the goose-backed runtime but not require it for mock/demo execution.

**Step 4: Run tests to verify they pass**

Run:
- `npm run build && node --test tests/cli-smoke.test.mjs`

Expected: PASS with working CLI smoke coverage.

**Step 5: Commit**

Run:
- `git add tests/cli-smoke.test.mjs src/cli/main.ts docs/goose/pr-workflow.md package.json README.md src/index.ts`
- `git commit -m "feat: add CLI entry points and goose delivery workflow"`

---

## Verification Gate Before Any PR Merge

Before goose opens or merges any PR, run:

- `npm run typecheck`
- `npm run build`
- `npm run test:adapter`
- `npm run test:planning`
- `npm run test:runtime`
- `node --test tests/goose-worker-contract.test.mjs`
- `node --test tests/goose-recipe-builder.test.mjs`
- `node --test tests/goose-worker-adapter.test.mjs`
- `node --test tests/orchestrator-goose-runtime.test.mjs`
- `node --test tests/orchestrator-approval-controls.test.mjs`
- `node --test tests/orchestrator-policy-engine.test.mjs`
- `node --test tests/orchestrator-e2e.test.mjs`
- `node --test tests/cli-smoke.test.mjs`

Expected: all PASS.

If all verification passes, goose may use the standard GitHub flow for that branch:

- `gh pr create --fill --base main`
- `gh pr merge --merge --delete-branch`

Do not merge if any required verification step fails.

## Async Review Rule

- This rule applies to every PR created from this plan, including each task-sized PR from Task 1 through Task 8.
- After a PR is ready, Codex review should be triggered automatically by workflow without a manual PR comment.
- Goose does not need to wait for the review to finish before merging if the local required checks already passed.
- Any review findings can be handled later in a separate follow-up PR.
- Treat the automatic review as mandatory signaling, not as a blocking gate for the initial merge.

## Notes

- The first goose integration target is the implementation layer only.
- `test-agent` and `review-agent` remain orchestrator-owned quality gates.
- Goose may self-test and self-repair internally, but external quality gates still decide final completion.
- Treat each major task above as a separate PR-sized delivery slice even if a single session can finish more than one task.
