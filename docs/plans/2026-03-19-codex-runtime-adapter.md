# Codex Runtime Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Phase 1 Codex review integration behind a reusable `CodexRuntimeAdapter` contract and add an SDK-backed Codex runtime implementation while preserving the existing `codex exec` backend as a first-class fallback.

**Architecture:** Keep the orchestrator and quality-gate surfaces backend-agnostic. Introduce one repository-owned Codex runtime contract, move shared event/result normalization under that contract, wrap the Phase 1 process backend behind it, then add a second backend powered by `@openai/codex-sdk`.

**Tech Stack:** TypeScript, Node.js, Codex CLI, `@openai/codex-sdk`, existing orchestrator/runtime modules, Node test runner

---

### Task 1: Add failing tests for the runtime contract and backend parity

**Files:**
- Create: `tests/codex-runtime-adapter.test.mjs`
- Create: `tests/codex-sdk-runtime-adapter.test.mjs`

**Step 1: Write the failing tests**

Cover:
- one repository-owned invocation contract for review execution
- backend-neutral normalized progress events
- backend-neutral normalized final result shape
- persistence of optional Codex runtime metadata
- parity expectations between `exec` and `sdk` adapters for equivalent mock inputs

**Step 2: Run the tests to verify they fail**

Run:

```bash
npm run build && node --test tests/codex-runtime-adapter.test.mjs tests/codex-sdk-runtime-adapter.test.mjs
```

Expected:
- FAIL because the runtime contract and SDK adapter do not exist yet

### Task 2: Add repository-owned Codex runtime contracts and metadata types

**Files:**
- Create: `src/adapters/codex-runtime-adapter.ts`
- Create: `src/schemas/codex-runtime.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/workers/contracts.ts`
- Modify: `src/index.ts`

**Step 1: Define the adapter contract**

Define:
- invocation request type
- streamed progress event type
- normalized final result type
- normalized error type
- optional resume metadata type

**Step 2: Add repository-owned runtime metadata**

Persist metadata such as:
- backend kind
- model id
- thread id when present
- run id when present
- last event timestamp

This metadata should be attached to repository-owned task/runtime structures, not left as backend-native objects.

**Step 3: Run focused schema tests**

Run:

```bash
npm run build && node --test tests/codex-runtime-adapter.test.mjs
```

Expected:
- PASS for the contract-level tests that do not depend on the backend implementation

### Task 3: Extract shared event and result normalization

**Files:**
- Create: `src/adapters/codex-event-normalizer.ts`
- Create: `src/adapters/codex-result-normalizer.ts`
- Modify: `src/adapters/codex-exec-review-adapter.ts`

**Step 1: Move backend-neutral logic out of Phase 1 code**

Extract:
- progress event normalization
- findings/result normalization
- error normalization

The goal is that neither backend owns the canonical result shape.

**Step 2: Re-run Phase 1 review tests**

Run:

```bash
npm run build && node --test tests/codex-exec-review-adapter.test.mjs tests/codex-runtime-adapter.test.mjs
```

Expected:
- PASS

### Task 4: Wrap the existing process backend behind `CodexRuntimeAdapter`

**Files:**
- Create: `src/adapters/codex-exec-runtime-adapter.ts`
- Modify: `src/adapters/codex-exec-process-runner.ts`
- Modify: `src/orchestrator/codex-exec-quality-gate-runner.ts`

**Step 1: Implement the exec-backed adapter**

The adapter should:
- call the existing process runner
- normalize events/results through the shared normalizers
- populate repository-owned runtime metadata
- preserve current Phase 1 behavior

**Step 2: Update the review gate to consume the adapter contract**

Refactor the gate runner so it no longer depends on exec-specific details directly.

**Step 3: Run exec backend regression tests**

Run:

```bash
npm run build && node --test tests/codex-exec-process-runner.test.mjs tests/codex-exec-review-adapter.test.mjs tests/codex-runtime-adapter.test.mjs
```

Expected:
- PASS

### Task 5: Add the SDK-backed runtime adapter

**Files:**
- Create: `src/adapters/codex-sdk-runtime-adapter.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add the SDK dependency**

Add:
- `@openai/codex-sdk`

**Step 2: Implement the SDK adapter**

Support:
- review invocation through the repository-owned contract
- streamed progress callbacks
- capture of SDK thread/run metadata into repository-owned metadata fields
- normalized error handling for auth/runtime failures

**Step 3: Run SDK-focused tests**

Run:

```bash
npm run build && node --test tests/codex-sdk-runtime-adapter.test.mjs
```

Expected:
- PASS

### Task 6: Add backend selection and examples

**Files:**
- Create: `src/adapters/codex-runtime-factory.ts`
- Create: `src/examples/run-codex-runtime-adapter-demo.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `package.json`

**Step 1: Add backend selection**

Support explicit backend selection such as:
- `exec`
- `sdk`

The selection should be visible in reporting and easy to override in tests/demos.

**Step 2: Add a runnable demo**

Demonstrate:
- selecting a backend
- streaming normalized events
- persisting runtime metadata
- resuming with repository-owned state still in control

**Step 3: Document the Phase 2 contract**

Document:
- why the adapter exists
- how `exec` and `sdk` differ operationally
- what metadata is persisted
- what remains future work

### Task 7: Add end-to-end parity validation

**Files:**
- Create: `tests/codex-runtime-parity.test.mjs`
- Modify: `tests/orchestrator-runtime.test.mjs`

**Step 1: Add parity coverage**

Assert that equivalent mocked `exec` and `sdk` runs normalize into the same:
- `review_status`
- `review_feedback`
- `risk_notes`
- `suggested_status`

**Step 2: Run full focused validation**

Run:

```bash
npm run typecheck
npm run build
node --test tests/codex-runtime-adapter.test.mjs tests/codex-sdk-runtime-adapter.test.mjs tests/codex-runtime-parity.test.mjs tests/orchestrator-runtime.test.mjs
git diff --check
```

Expected:
- all commands exit successfully

## Deliverables

- a repository-owned `CodexRuntimeAdapter` contract
- a wrapped `codex exec` backend
- a new `@openai/codex-sdk` backend
- shared event/result normalization
- repository-owned persisted Codex runtime metadata
- parity tests, demo coverage, and documentation
