# Orchestrator Runtime MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add concrete orchestrator runtime modules, extend the orchestration loop through quality gates and retry escalation, and ship a runnable demo fixture.

**Architecture:** Keep planning tasks as the only DAG nodes. Add small runtime modules for dispatch, gates, retries, and reporting, then let `MainOrchestrator` coordinate them while persisting typed runtime state and emitting a final run summary.

**Tech Stack:** TypeScript, Node ESM, Node built-in test runner, existing model-router and runtime schema modules

---

### Task 1: Define failing runtime expectations

**Files:**
- Create: `tests/orchestrator-runtime.test.mjs`

**Step 1: Write the failing test**

Cover:
- successful 3-task orchestration with dependencies,
- retry escalation to the next role-allowed model,
- dependency blocking after terminal-negative upstream status.

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/orchestrator-runtime.test.mjs`
Expected: FAIL because runtime modules / APIs do not exist yet or the orchestrator does not satisfy the new behavior.

### Task 2: Add runtime module contracts and implementations

**Files:**
- Create: `src/orchestrator/implementation-dispatcher.ts`
- Create: `src/orchestrator/quality-gate-runner.ts`
- Create: `src/orchestrator/retry-escalation-manager.ts`
- Create: `src/orchestrator/reporting-manager.ts`
- Modify: `src/adapters/model-router.ts`
- Modify: `src/schemas/runtime.ts`

**Step 1: Implement the minimal types and default mock classes**

Include:
- explicit dispatcher and gate result types,
- role-based model fallback helper,
- run summary types,
- default mock implementations for demo wiring.

**Step 2: Run type-aware verification**

Run: `npm run typecheck`
Expected: may still fail until orchestrator integration is complete.

### Task 3: Refactor the main orchestration loop

**Files:**
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/storage/run-store.ts` if helper behavior is needed

**Step 1: Integrate runtime modules**

Add:
- runtime persistence checkpoints,
- implementation dispatch + quality gates,
- retry/escalation decisions,
- dependency blocking,
- final summary return type.

**Step 2: Run focused verification**

Run: `npm run build && node --test tests/orchestrator-runtime.test.mjs`
Expected: PASS once orchestration behavior matches the tests.

### Task 4: Add example fixture and runnable demo

**Files:**
- Create: `src/examples/planning-fixtures.ts`
- Create: `src/examples/run-orchestration-demo.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

**Step 1: Add a three-task planning fixture with dependencies**

Use only `frontend-agent` / `backend-agent` as task owners and keep quality gates separate.

**Step 2: Add demo runner**

Print:
- run id,
- per-task terminal status,
- retry/model changes when they happen,
- concise final counts.

**Step 3: Verify demo**

Run: `npm run demo:orchestrator`
Expected: concise successful summary output.

### Task 5: Document and verify

**Files:**
- Modify: `README.md`

**Step 1: Document new runtime modules and demo usage**

Include:
- module responsibilities,
- mock/demo nature of adapters,
- commands for typecheck and demo.

**Step 2: Run final verification**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build && node --test tests/orchestrator-runtime.test.mjs`
Expected: PASS

Run: `npm run demo:orchestrator`
Expected: PASS with concise summary
