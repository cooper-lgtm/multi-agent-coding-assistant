# Persistence, Resume, and Operational State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement PR5 so orchestration runs become durable, resumable, and inspectable through a file-backed state layer.

**Architecture:** Keep `RuntimeState` as the single source of truth, extend it with small run-level lifecycle/control metadata, and add a file-backed `RunStore` that writes `manifest.json`, `runtime.json`, and `events.jsonl` under `state/runs/<run-id>/`. Resume should reload the latest runtime snapshot and continue from safe checkpoints instead of replaying every historical step.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing orchestrator/runtime modules, filesystem-backed JSON/JSONL artifacts

---

### Task 1: Add failing persistence and resume tests

**Files:**
- Create: `tests/file-backed-run-store.test.mjs`
- Create: `tests/orchestrator-persistence.test.mjs`

**Step 1: Write file-backed store tests**

Assert that:
- saving a run creates `state/runs/<run-id>/manifest.json`
- saving a run creates `state/runs/<run-id>/runtime.json`
- saving a run creates `state/runs/<run-id>/events.jsonl`
- `load(runId)` round-trips a saved runtime snapshot correctly
- manifest metadata reflects the current run lifecycle and task counts

**Step 2: Write orchestrator resume/control tests**

Assert that:
- a resumed run continues from the saved runtime snapshot instead of restarting from scratch
- transient task states are normalized into safe resumable states on reload
- `pause_requested` stops new scheduling at the next safe checkpoint and marks the run `paused`
- `cancel_requested` prevents new scheduling and marks remaining non-terminal work as `cancelled`

**Step 3: Run tests to verify they fail**

Run:
- `npm run build && node --test tests/file-backed-run-store.test.mjs tests/orchestrator-persistence.test.mjs`

Expected: FAIL because the file-backed store, run manifests, and resume/control behavior do not exist yet.

---

### Task 2: Extend runtime and run-store contracts

**Files:**
- Modify: `src/schemas/runtime.ts`
- Modify: `src/storage/run-store.ts`
- Create: `src/storage/file-backed-run-store.ts`
- Modify: `src/index.ts`

**Step 1: Add run-level lifecycle and control metadata**

Extend `RuntimeState` with small run-level fields such as:
- `status`
- `created_at`
- `updated_at`
- `storage_version`
- `control.pause_requested`
- `control.cancel_requested`

Keep task-level state unchanged unless required for safe resume behavior.

**Step 2: Expand storage interfaces**

Keep `save(runtime)` and `load(runId)`, and add inspection/control helpers such as:
- `listRuns()`
- `loadManifest(runId)`
- `loadEvents(runId)`
- `requestPause(runId)`
- `requestCancel(runId)`

Keep `InMemoryRunStore` available for lightweight tests and demos.

**Step 3: Implement `FileBackedRunStore`**

Write a file-backed store that:
- creates `state/runs/<run-id>/`
- writes `manifest.json`
- writes `runtime.json`
- writes `events.jsonl`
- uses atomic snapshot writes where practical
- can reconstruct runtime state and inspection data from disk

**Step 4: Export the new storage APIs**

Expose the file-backed store and manifest helpers through `src/index.ts`.

---

### Task 3: Integrate resume, pause, and cancel into the orchestrator

**Files:**
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/orchestrator/dag-builder.ts` if runtime bootstrap metadata needs to be initialized there

**Step 1: Initialize run lifecycle metadata**

When a new run starts:
- set run-level `status` to `running`
- populate timestamps and storage version
- persist the initial manifest/snapshot early

**Step 2: Add resume entry points**

Implement a resume path such as:
- `resume(runId)` on `MainOrchestrator`, or
- a logically equivalent API that loads a saved runtime and continues execution

On resume:
- preserve terminal task states
- normalize transient in-flight task states into safe resumable states
- continue the orchestration loop without re-planning from scratch

**Step 3: Honor control requests at safe checkpoints**

Before scheduling new tasks and after significant step boundaries:
- reload or consult current control flags
- if pause is requested, persist and end with run status `paused`
- if cancel is requested, mark remaining non-terminal tasks as `cancelled`, persist, and stop execution

**Step 4: Persist operational events clearly**

Ensure the reporting layer records events that make pause/resume/cancel transitions obvious in manifests and event logs.

---

### Task 4: Add inspection/demo coverage and repository polish

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Create: `src/examples/run-persistence-demo.ts`
- Modify: `.gitignore`

**Step 1: Add a runnable persistence/resume demo**

Demonstrate:
- creating a run with the file-backed store
- inspecting the generated `state/runs/<run-id>/` artifacts
- reloading and resuming a saved run

**Step 2: Add scripts / docs**

Add a script such as:
- `demo:persistence`

Document:
- artifact layout under `state/`
- how resume works
- what pause/cancel guarantee and what they do not guarantee

**Step 3: Ignore generated state artifacts appropriately**

Update `.gitignore` so the persisted run artifacts do not pollute normal repo diffs.

**Step 4: Run full verification**

Run:
- `npm run typecheck`
- `npm run build`
- `node --test tests/file-backed-run-store.test.mjs tests/orchestrator-persistence.test.mjs`
- `npm run test:adapter`
- `npm run test:planning`
- `npm run test:runtime`
- `npm run demo:persistence`

Expected: all PASS.

---

## Notes

- PR5 should keep the storage design intentionally file-based and single-writer.
- Resume is checkpoint-based, not historical replay.
- Pause/cancel are cooperative at safe checkpoints, not hard interrupts.
- The real worker execution engine still remains a later concern outside this PR.