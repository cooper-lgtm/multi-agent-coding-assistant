# PR10 Rich Context Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add planning-time execution guidance and runtime context injection so implementation workers start each task with compact, deterministic repo and verification context.

**Architecture:** Extend planning tasks with execution guidance, carry that guidance into runtime nodes, and build a runtime context package immediately before worker dispatch. Thread the resulting context through worker contracts, OpenClaw envelopes, goose recipe inputs, and implementation prompts without changing the rule that the orchestrator remains the only global controller.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing planning/runtime schemas, OpenClaw adapter contracts, goose recipe packaging, Markdown prompt assets

---

## Slice Breakdown

If implementing PR10 incrementally, use:
- `docs/plans/2026-03-23-runtime-success-breakdown.md`

The recommended first slice is:
- `PR10a: Execution Guidance Contracts and DAG Propagation`

---

### Task 1: Add execution-guidance schema support

**Files:**
- Modify: `src/schemas/planning.ts`
- Modify: `src/orchestrator/planning-validator.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Modify: `src/orchestrator/dag-builder.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/examples/planning-fixtures.ts`
- Modify: `tests/planning-pipeline.test.mjs`
- Modify: `src/index.ts`

**Step 1: Write the failing planning test**

Update `tests/planning-pipeline.test.mjs` to assert that each `PlanningTask` may carry `execution_guidance` with:
- `must_read_files`
- `verification_commands`
- `environment_checks`
- `definition_of_done`
- `reconsider_signals`

Also assert the normalized `PlanningResult` survives DAG conversion with those fields preserved on runtime tasks.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/planning-pipeline.test.mjs`

Expected:
FAIL because the planning/runtime schemas do not yet support `execution_guidance`.

**Step 3: Write the minimal schema implementation**

Implement:
- a new `ExecutionGuidance` interface in `src/schemas/planning.ts`
- validation rules in `src/orchestrator/planning-validator.ts`
- normalization defaults in `src/planning/planning-normalizer.ts`
- DAG propagation in `src/orchestrator/dag-builder.ts`
- runtime-node storage in `src/schemas/runtime.ts`
- fixture updates in `src/examples/planning-fixtures.ts`

Keep the guidance compact and execution-focused; do not add speculative fields.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/planning-pipeline.test.mjs`

Expected:
PASS with `execution_guidance` surviving normalize/validate/DAG conversion.

**Step 5: Commit**

Run:
`git add src/schemas/planning.ts src/orchestrator/planning-validator.ts src/planning/planning-normalizer.ts src/orchestrator/dag-builder.ts src/schemas/runtime.ts src/examples/planning-fixtures.ts tests/planning-pipeline.test.mjs src/index.ts`

`git commit -m "feat: add execution guidance to planning tasks"`

### Task 2: Build runtime context and local environment discovery

**Files:**
- Create: `src/orchestrator/runtime-context-builder.ts`
- Create: `src/orchestrator/local-context-discovery.ts`
- Create: `tests/runtime-context-builder.test.mjs`
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `docs/context/repo-context.md`
- Modify: `src/index.ts`

**Step 1: Write the failing runtime-context test**

Add `tests/runtime-context-builder.test.mjs` that asserts the builder can combine:
- checked-in repo context from `docs/context/repo-context.md`
- task-level `execution_guidance`
- basic local discovery results such as detected package/test commands
- retry handoff information when present

The test should expect a compact worker-facing context shape, not raw full-file dumps.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/runtime-context-builder.test.mjs`

Expected:
FAIL because there is no runtime-context builder or local discovery module yet.

**Step 3: Write the minimal runtime-context implementation**

Implement:
- `src/orchestrator/local-context-discovery.ts` for deterministic discovery of repo-local execution hints
- `src/orchestrator/runtime-context-builder.ts` for assembling compact worker context
- worker-contract fields in `src/workers/contracts.ts` for:
  - `repo_context_summary`
  - `environment_snapshot`
  - `task_context_files`
  - `verification_plan`
  - `time_budget_hint`
- runtime-node storage only where needed for reporting or resume safety

Do not make the builder depend on live network calls.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/runtime-context-builder.test.mjs`

Expected:
PASS with deterministic context assembly from repo docs and local discovery.

**Step 5: Commit**

Run:
`git add src/orchestrator/runtime-context-builder.ts src/orchestrator/local-context-discovery.ts tests/runtime-context-builder.test.mjs src/workers/contracts.ts src/schemas/runtime.ts docs/context/repo-context.md src/index.ts`

`git commit -m "feat: add runtime context builder"`

### Task 3: Thread rich context through OpenClaw and goose payloads

**Files:**
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `tests/openclaw-runtime-adapter.test.mjs`
- Modify: `tests/goose-recipe-builder.test.mjs`
- Modify: `docs/goose/task-contract.md`
- Modify: `src/index.ts`

**Step 1: Write the failing adapter and recipe tests**

Update:
- `tests/openclaw-runtime-adapter.test.mjs`
- `tests/goose-recipe-builder.test.mjs`

Assert that worker payloads now include the new context fields and that goose recipe inputs receive:
- compact repo context
- environment snapshot
- verification plan
- reconsider signals from planning guidance

**Step 2: Run tests to verify they fail**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
FAIL because the adapters do not yet serialize the richer context.

**Step 3: Write the minimal adapter implementation**

Update:
- `src/adapters/openclaw-runtime-adapter.ts`
- `src/adapters/goose-recipe-builder.ts`

Ensure:
- OpenClaw worker envelopes carry the new worker-context fields
- goose recipe inputs stay compact and portable across clones
- `docs/goose/task-contract.md` explains the new context that goose should consume before editing

**Step 4: Run tests to verify they pass**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
PASS with stable worker-payload contracts.

**Step 5: Commit**

Run:
`git add src/adapters/openclaw-runtime-adapter.ts src/adapters/goose-recipe-builder.ts tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs docs/goose/task-contract.md src/index.ts`

`git commit -m "feat: inject rich context into worker payloads"`

### Task 4: Upgrade implementation prompts and integration coverage

**Files:**
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`
- Modify: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `README.md`

**Step 1: Write the failing orchestration assertions**

Update `tests/orchestrator-goose-runtime.test.mjs` so goose-backed implementation scenarios assert that:
- context-rich worker payloads reach the runtime path
- verification-plan fields are preserved into reporting/persistence where expected

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/orchestrator-goose-runtime.test.mjs`

Expected:
FAIL because the richer context is not yet visible end-to-end.

**Step 3: Update prompts and docs**

Strengthen `prompts/frontend-agent.md` and `prompts/backend-agent.md` so workers explicitly:
- read injected context before edits
- use the supplied verification plan instead of guessing
- report missing or conflicting context as blockers

Update `README.md` to mention the new runtime-context direction and relevant tests.

**Step 4: Run the focused verification set**

Run:
`npm run build && node --test tests/planning-pipeline.test.mjs tests/runtime-context-builder.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
PASS with end-to-end context propagation through planning, runtime, adapter, and goose seams.

**Step 5: Commit**

Run:
`git add prompts/frontend-agent.md prompts/backend-agent.md tests/orchestrator-goose-runtime.test.mjs README.md`

`git commit -m "docs: teach workers to use injected runtime context"`
