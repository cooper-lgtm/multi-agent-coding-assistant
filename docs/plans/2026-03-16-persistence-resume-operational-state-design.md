# Persistence, Resume, and Operational State Design

**Date:** 2026-03-16

## Goal

Make orchestration runs durable, inspectable, and recoverable without breaking the current modular runtime architecture.

PR5 should let the repository:
- persist runs to disk under `state/`
- reload a prior run from disk
- resume an interrupted run from its last checkpoint
- request pause / cancellation cooperatively
- inspect run manifests and event history for debugging

## Current State

The repository already has the right architectural seam for persistence, but only the minimal in-memory implementation exists:

- `RunStore` exposes `save(runtime)` and `load(runId)`
- `InMemoryRunStore` stores full `RuntimeState` snapshots in a `Map`
- `MainOrchestrator` already persists around meaningful checkpoints through `persist(runtime)`
- runtime events are collected in-memory on `runtime.events`

This is enough for the MVP runtime loop, but not enough for:
- process restarts
- durable auditability
- pause / cancel signaling
- run inspection outside the live process
- resume after interruption

## Design Constraints

1. Keep `MainOrchestrator` as a coordinator, not a storage-heavy monolith.
2. Preserve the existing planning/runtime boundary: planning tasks remain implementation-only tasks.
3. Keep the current typed runtime state as the source of truth instead of inventing a second parallel state model.
4. Prefer simple file artifacts over a database for this PR.
5. Optimize for debuggability and future tooling, not just raw save/load.

## Approaches Considered

### 1. Save a single `runtime.json` file only

**Pros**
- minimal implementation surface
- easiest round-trip load/save behavior

**Cons**
- poor inspectability for humans
- no append-only event history
- awkward for pause/cancel signaling
- harder to evolve into operational tooling

### 2. Save a manifest + runtime snapshot + event log under `state/`

**Pros**
- keeps the full runtime snapshot available
- adds human- and tool-friendly inspection points
- naturally supports resume and control requests
- stays file-based and simple

**Cons**
- more files than a one-file snapshot
- requires keeping snapshot + manifest in sync

### 3. Introduce SQLite or another embedded database

**Pros**
- stronger querying and indexing potential
- transactional behavior

**Cons**
- overkill for the current repository stage
- adds operational and testing complexity too early
- weakens the readability of saved run artifacts

## Recommendation

Use **Approach 2**.

PR5 should introduce a file-backed run store that writes three kinds of artifacts under `state/runs/<run-id>/`:

- `manifest.json` — high-level run metadata and control state
- `runtime.json` — full typed `RuntimeState` snapshot
- `events.jsonl` — append-only runtime event log for inspection and debugging

This keeps the repository aligned with the roadmap requirement for stateful, inspectable runs while staying intentionally lightweight.

## Proposed State Layout

```text
state/
  runs/
    <run-id>/
      manifest.json
      runtime.json
      events.jsonl
```

## Manifest Shape

`manifest.json` should be a compact operational summary, not a replacement for the full runtime snapshot.

Suggested contents:

- `schema_version`
- `run_id`
- `epic`
- `planning_mode`
- `status` (run-level lifecycle status)
- `created_at`
- `updated_at`
- `last_persisted_at`
- `task_counts`
- `control`:
  - `pause_requested`
  - `cancel_requested`
- `artifacts`:
  - `runtime_snapshot`
  - `event_log`

## Runtime Schema Additions

PR5 should add small run-level metadata to `RuntimeState` instead of building a separate state machine outside it.

Suggested additions:

- `status`: `running | paused | completed | needs_fix | blocked | failed | cancelled`
- `created_at`
- `updated_at`
- `storage_version`
- `control`:
  - `pause_requested: boolean`
  - `cancel_requested: boolean`

This keeps task-level state where it already belongs while giving the whole run a durable lifecycle.

## Resume Semantics

Resume should be **checkpoint-based**, not replay-based.

That means:
- the file-backed store loads the latest `runtime.json`
- `MainOrchestrator.resume(runId)` continues from the saved runtime state
- already terminal tasks remain untouched
- tasks in `pending` can be scheduled again
- tasks in transient states like `routed`, `running`, `implementation_done`, or `testing` should be normalized into a resumable state before continuing

For PR5, the safest normalization rule is:
- if a run is resumed after interruption, any non-terminal in-flight task becomes `pending` unless a more specific persisted checkpoint proves a later stable state

This avoids pretending a partially executed step finished successfully.

## Pause and Cancel Semantics

Pause and cancel should be **cooperative**, not forceful.

PR5 does not need to interrupt an already-running external worker mid-process.
Instead:

- `pause_requested` stops the orchestrator from scheduling new work at the next safe checkpoint and marks the run `paused`
- `cancel_requested` stops future scheduling and marks remaining non-terminal work as `cancelled` at the next safe checkpoint

This matches the current single-process runtime and avoids fake guarantees.

## Inspection Helpers

PR5 should expose inspection helpers through the storage layer, for example:

- `listRuns()`
- `loadManifest(runId)`
- `loadEvents(runId)`
- `load(runId)` for the full runtime snapshot

These helpers should make it easy to debug runs without manually parsing arbitrary files.

## Implementation Boundaries

PR5 should include:
- file-backed run persistence
- manifest + runtime snapshot + event log artifacts
- resume support from saved runtime state
- cooperative pause / cancel requests
- run inspection helpers

PR5 should **not** include:
- the full real worker execution engine
- distributed locking / multi-writer coordination
- DB-backed persistence
- forced interruption of already-running external jobs
- productized CLI commands beyond small debug/demo helpers

## Why This Fits the Existing Roadmap

This design follows the delivery roadmap directly:
- PR1 established the runtime loop
- PR2 established the planning pipeline
- PR3 and PR4 built the adapter seam and richer worker execution context
- PR5 now makes that runtime state durable and resumable

In other words, PR5 should persist the runtime model that already exists instead of redesigning it.