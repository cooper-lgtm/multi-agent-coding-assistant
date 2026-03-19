# Three Operating Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Productize the repository around three explicit operating modes: `all-plan`, `task-run`, and `end-to-end`.

**Architecture:** Keep one shared planning and runtime kernel. Add explicit mode terminology, artifact boundaries, and entry surfaces on top of the existing contracts instead of creating separate orchestrators. Implement `all-plan` and `task-run` as distinct product flows, then compose them into `end-to-end`.

**Tech Stack:** TypeScript, Node ESM, existing planning/runtime schemas, current CLI scaffold, Node test runner

---

### Task 1: Add explicit operating-mode terminology to schemas and docs

**Files:**
- Modify: `src/schemas/planning.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `ARCHITECTURE.md`
- Test: `tests/cli-smoke.test.mjs`

**Step 1: Write the failing test**

Add assertions that future help text or mode summaries expose:

- `all-plan`
- `task-run`
- `end-to-end`

**Step 2: Run test to verify it fails**

Run: `node --test tests/cli-smoke.test.mjs`
Expected: FAIL because the current CLI and docs do not expose explicit operating-mode terminology.

**Step 3: Write minimal implementation**

Add a shared mode type and document how it maps to planning/runtime entry points.

**Step 4: Run test to verify it passes**

Run: `node --test tests/cli-smoke.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/schemas/planning.ts src/schemas/runtime.ts README.md PRODUCT.md ARCHITECTURE.md tests/cli-smoke.test.mjs
git commit -m "docs: define operating mode terminology"
```

### Task 2: Implement `all-plan` as a planning-only artifact flow

**Files:**
- Modify: `src/planning/planning-controller.ts`
- Modify: `src/planning/planning-pipeline.ts`
- Modify: `src/examples/run-planning-demo.ts`
- Create: `tests/planning-artifact-output.test.mjs`

**Step 1: Write the failing test**

Add a test that expects the planning layer to:

- accept a request in `all-plan`
- return a validated `planning result`
- stop before runtime DAG execution

**Step 2: Run test to verify it fails**

Run: `node --test tests/planning-artifact-output.test.mjs`
Expected: FAIL because no explicit planning-only product entry exists yet.

**Step 3: Write minimal implementation**

Add a planning-only facade that produces the normalized plan artifact and summary metadata without entering the runtime loop.

**Step 4: Run test to verify it passes**

Run: `node --test tests/planning-artifact-output.test.mjs tests/planning-pipeline.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/planning/planning-controller.ts src/planning/planning-pipeline.ts src/examples/run-planning-demo.ts tests/planning-artifact-output.test.mjs
git commit -m "feat: add all-plan artifact flow"
```

### Task 3: Land PR19 follow-up inside `all-plan`

**Files:**
- Modify: `src/schemas/planning.ts`
- Modify: `src/planning/contracts.ts`
- Modify: `src/planning/planning-pipeline.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Modify: `src/planning/mock-planners.ts`
- Modify: `src/planning/debate-synthesizer.ts`
- Test: `tests/planning-pipeline.test.mjs`
- Test: `tests/planning-coordination-harness.test.mjs`

**Step 1: Write the failing test**

Add planning tests that expect:

- `planning-agent` to appear as the formal debate coordinator
- a future `ClarifiedPlanningBrief` trace artifact
- bounded clarification and cross-review metadata

**Step 2: Run test to verify it fails**

Run: `node --test tests/planning-pipeline.test.mjs tests/planning-coordination-harness.test.mjs`
Expected: FAIL because debate planning still uses analyzer fan-out plus local synthesis.

**Step 3: Write minimal implementation**

Implement coordinator-led planning inside `all-plan`, keeping planner interaction bounded and artifact-based.

**Step 4: Run test to verify it passes**

Run: `npm run test:planning && node --test tests/planning-coordination-harness.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/schemas/planning.ts src/planning/contracts.ts src/planning/planning-pipeline.ts src/planning/planning-normalizer.ts src/planning/mock-planners.ts src/planning/debate-synthesizer.ts tests/planning-pipeline.test.mjs tests/planning-coordination-harness.test.mjs
git commit -m "feat: implement coordinator-led all-plan flow"
```

### Task 4: Implement `task-run` as execution from an existing plan artifact

**Files:**
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/dag-builder.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Create: `tests/task-run-mode.test.mjs`

**Step 1: Write the failing test**

Add a test that expects the runtime layer to:

- start from a provided `planning result`
- skip planning creation
- execute implementation, quality gates, retry, and reporting as usual

**Step 2: Run test to verify it fails**

Run: `node --test tests/task-run-mode.test.mjs`
Expected: FAIL because the current orchestrator API is still centered on `createPlan(request)`.

**Step 3: Write minimal implementation**

Add an explicit entry point that accepts a validated plan artifact and runs the normal DAG/runtime loop.

**Step 4: Run test to verify it passes**

Run: `node --test tests/task-run-mode.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-persistence.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/main-orchestrator.ts src/orchestrator/dag-builder.ts src/storage/run-store.ts src/storage/file-backed-run-store.ts tests/task-run-mode.test.mjs
git commit -m "feat: add task-run execution entrypoint"
```

### Task 5: Compose `end-to-end` from `all-plan` and `task-run`

**Files:**
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/examples/run-orchestration-demo.ts`
- Test: `tests/orchestrator-e2e.test.mjs`

**Step 1: Write the failing test**

Add a test that expects `end-to-end` mode to:

- create and preserve the planning artifact
- optionally pause after planning for approval
- continue into runtime execution without bypassing existing contracts

**Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator-e2e.test.mjs tests/orchestrator-approval-controls.test.mjs`
Expected: FAIL until mode composition is explicit.

**Step 3: Write minimal implementation**

Refactor the orchestration facade so the public end-to-end flow is explicit composition rather than an implicit one-shot run.

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e && node --test tests/orchestrator-approval-controls.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/main-orchestrator.ts src/examples/run-orchestration-demo.ts tests/orchestrator-e2e.test.mjs
git commit -m "feat: compose end-to-end mode from plan and task-run"
```

### Task 6: Wire mode-aware CLI entry points

**Files:**
- Modify: `src/cli/main.ts`
- Modify: `README.md`
- Test: `tests/cli-smoke.test.mjs`

**Step 1: Write the failing test**

Add CLI tests that expect:

- `plan` to map to `all-plan`
- `run --plan-file` or equivalent to map to `task-run`
- `run` from natural-language request to map to `end-to-end`

**Step 2: Run test to verify it fails**

Run: `node --test tests/cli-smoke.test.mjs`
Expected: FAIL because CLI command wiring is currently scaffold-only.

**Step 3: Write minimal implementation**

Implement mode-aware command parsing and route each command to the correct facade.

**Step 4: Run test to verify it passes**

Run: `node --test tests/cli-smoke.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/main.ts README.md tests/cli-smoke.test.mjs
git commit -m "feat: add mode-aware CLI routing"
```

### Task 7: Add regression coverage and operational docs for the mode split

**Files:**
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `docs/context/repo-context.md`
- Modify: `README.md`
- Create: `tests/fixtures/planning/all-plan-golden.json`
- Create: `tests/fixtures/runtime/task-run-golden.json`
- Test: `tests/orchestrator-e2e.test.mjs`

**Step 1: Write the failing test**

Add mode-level golden assertions for:

- planning-only output
- execution-from-plan output
- end-to-end composed output

**Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator-e2e.test.mjs`
Expected: FAIL until the new fixtures and summaries exist.

**Step 3: Write minimal implementation**

Capture stable fixtures, document recurring mode-boundary mistakes, and update repository context artifacts.

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/reviews/recurring-issues.md docs/context/repo-context.md README.md tests/fixtures/planning/all-plan-golden.json tests/fixtures/runtime/task-run-golden.json tests/orchestrator-e2e.test.mjs
git commit -m "test: add operating mode regression coverage"
```

