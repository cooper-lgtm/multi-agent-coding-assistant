# Worker Execution Bridge MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add richer worker execution contracts, richer mock dispatcher/gate outputs, and orchestration reporting for the PR4 worker bridge MVP.

**Architecture:** Extend the shared worker contract layer so implementation roles and quality-gate roles both carry changed files, blockers, evidence, and retry handoff context. Thread that context through the runtime task record, mock execution surfaces, adapter envelopes, and reporting summaries without introducing the full real execution engine.

**Tech Stack:** TypeScript, Node.js test runner, existing orchestrator/runtime modules, OpenClaw adapter envelopes

---

### Task 1: Define richer worker bridge contracts

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/openclaw-runtime-adapter.test.mjs`

**Step 1: Write the failing test**

Assert that worker request/result envelopes expose:
- `changed_files`
- `blocker_category`
- `blocker_message`
- `implementation_evidence`
- `test_evidence`
- `review_feedback`
- `prior_attempt`

**Step 2: Run test to verify it fails**

Run: `npm run test:adapter`
Expected: FAIL because the worker payloads and results do not yet expose the richer fields.

**Step 3: Write minimal implementation**

Add shared worker-context and retry-handoff types, then thread them into runtime task summaries and OpenClaw worker payload shaping.

**Step 4: Run test to verify it passes**

Run: `npm run test:adapter`
Expected: PASS with richer worker request/result coverage.

### Task 2: Upgrade dispatcher, quality gates, and orchestration reporting

**Files:**
- Modify: `src/orchestrator/implementation-dispatcher.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Test: `tests/orchestrator-runtime.test.mjs`

**Step 1: Write the failing test**

Assert that retries preserve prior-attempt context, downstream dependency blocking records blocker metadata, and final reporting surfaces changed files plus evidence arrays.

**Step 2: Run test to verify it fails**

Run: `npm run test:runtime`
Expected: FAIL because the orchestrator currently only stores summary strings.

**Step 3: Write minimal implementation**

Make the mock dispatcher and quality gate runner emit richer bridge outputs, persist them on each task, create retry handoff snapshots, and carry them into run summaries.

**Step 4: Run test to verify it passes**

Run: `npm run test:runtime`
Expected: PASS with richer runtime evidence and retry reporting.

### Task 3: Refresh demos and verification

**Files:**
- Modify: `src/examples/openclaw-adapter-fixtures.ts`
- Modify: `src/examples/run-openclaw-adapter-demo.ts`
- Modify: `src/examples/run-orchestration-demo.ts`
- Modify: `README.md`

**Step 1: Update the demos**

Show richer worker request context and richer orchestration summaries so the MVP is inspectable without a real execution engine.

**Step 2: Run the verification commands**

Run:
- `npm run typecheck`
- `npm run build`
- `npm run test:adapter`
- `npm run test:planning`
- `npm run test:runtime`

Expected: all PASS.
