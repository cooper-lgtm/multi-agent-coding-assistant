# Codex Runtime Adapter Design

**Date:** 2026-03-19

## Goal

Define the second-phase architecture for lifting Codex integration behind a reusable `CodexRuntimeAdapter` abstraction and adding an SDK-backed runtime implementation without coupling the orchestrator directly to `@openai/codex-sdk`.

## Context

The immediate Phase 1 integration path uses `codex exec --json` because it matches the repository's current local process-adapter model and gives strong local observability.

That is the right first step, but it is not the right long-term boundary if this repository wants:
- richer Codex-backed quality gates
- resumable or thread-aware Codex interactions
- backend selection between process mode and SDK mode
- consistent event normalization across different Codex execution backends

This repository already has:
- explicit adapter seams
- file-backed run persistence
- flexible runtime event typing
- orchestrator code that should remain agnostic to backend-specific lifecycle details

Phase 2 should preserve those strengths instead of letting SDK concerns leak into `quality-gate-runner.ts` or `main-orchestrator.ts`.

## Non-goals

- do not remove the `codex exec` backend introduced in Phase 1
- do not make the orchestrator depend directly on SDK thread/session types
- do not migrate planning or implementation dispatch to Codex in the same phase
- do not replace file-backed runtime state with SDK-owned persistence
- do not turn this phase into a GitHub-hosted automation design

## Constraints

- the orchestrator remains backend-agnostic
- local observability and progress streaming must stay first-class
- resume behavior must continue to treat repository runtime state as the source of truth
- backend choice (`exec` vs `sdk`) must be explicit and testable
- normalized findings and evidence must stay stable across backends
- SDK-specific metadata may be persisted, but only behind repository-owned types

## Planning / Runtime Contract Check

Current repository contracts suggest a clean abstraction is feasible:
- `QualityGateRunner` already hides gate execution behind one method.
- `RuntimeEvent.type` is open-ended, so Codex backend events can be normalized without a large schema rewrite.
- `ExecutionNode` and `WorkerExecutionContext` already store evidence and retry handoff, but they do not yet have a dedicated place for Codex runtime metadata such as backend, thread id, or run id.
- `FileBackedRunStore` persists `RuntimeState` and `events.jsonl`, so adapter-owned metadata can survive pause/resume once it is added to repository-owned schema fields.

The main contract gap for Phase 2 is a repository-owned Codex runtime contract.

## Options

### Option 1: Replace the `codex exec` integration with direct SDK calls inside the quality gate runner

Pros:
- quickest path to a working SDK review flow

Cons:
- hard-wires one backend into the quality gate layer
- mixes orchestration concerns with provider/runtime concerns
- makes it harder to preserve a process-mode fallback

### Option 2: Introduce `CodexRuntimeAdapter` and support both `exec` and `sdk`

Pros:
- keeps the orchestrator decoupled from backend mechanics
- preserves the local process backend as a fallback
- gives one place to normalize progress events and final results
- makes later Codex-backed roles easier to add

Cons:
- requires a small contract layer before the SDK implementation

### Option 3: Stay on `codex exec` indefinitely and defer abstraction

Pros:
- least short-term code

Cons:
- accumulates backend assumptions in the review gate implementation
- makes future SDK migration riskier
- limits reuse across future Codex-backed workflows

## Recommendation

Use Option 2.

Phase 1 should land the first useful local review path. Phase 2 should then extract that path behind a stable adapter so the repository can adopt SDK capabilities without rewriting the orchestrator every time the backend changes.

## Final Design

### 1. Add a repository-owned Codex runtime contract

Create a new adapter contract that defines:
- invocation input
- streamed progress callbacks
- normalized event payloads
- normalized final result payloads
- normalized runtime errors
- optional resume metadata

Proposed file:
- `src/adapters/codex-runtime-adapter.ts`

This contract should be repository-owned and should not expose SDK-native objects at the orchestrator boundary.

### 2. Split backend implementations from shared normalization

Keep normalization logic backend-neutral:
- request shaping
- event normalization
- findings/result normalization
- error normalization

Then provide two implementations:
- `CodexExecRuntimeAdapter`
- `CodexSdkRuntimeAdapter`

Proposed files:
- `src/adapters/codex-exec-runtime-adapter.ts`
- `src/adapters/codex-sdk-runtime-adapter.ts`
- `src/adapters/codex-event-normalizer.ts`
- `src/adapters/codex-result-normalizer.ts`

### 3. Persist repository-owned Codex runtime metadata

Add an optional repository schema field for metadata such as:
- backend kind
- model id
- thread id
- run id
- last successful event timestamp

This metadata should live in repository-owned types so:
- it can be serialized into `runtime.json`
- resume logic can see it
- `TaskRunSummary` can surface it when useful

Possible homes:
- a dedicated `CodexRuntimeMetadata` type under `src/schemas/`
- an optional `codex_runtime_metadata` field on `ExecutionNode` and related worker context types

### 4. Make quality-gate execution depend on the adapter, not the backend

Refactor the real review gate implementation from Phase 1 so it depends on `CodexRuntimeAdapter`.

That means:
- the quality gate runner chooses a backend through configuration or a factory
- the runner consumes normalized events/results only
- resume and persistence stay repository-driven

### 5. Keep `codex exec` as a first-class fallback backend

The SDK backend should not erase the benefits of the process backend.

The repository should keep:
- a locally observable process mode
- a backend switch for environments that do not want SDK auth/runtime behavior
- tests that prove both backends normalize to the same review result shape

## Affected Modules

- `src/adapters/`
- `src/orchestrator/quality-gate-runner.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `src/storage/`
- `src/examples/`
- `tests/`

## Risks

1. SDK thread lifecycle could become the de facto source of truth if repository-owned metadata is underspecified.
2. Two backends may drift if normalization is duplicated instead of shared.
3. Resume semantics can get ambiguous if thread metadata is persisted without a clear ownership model.
4. Backend selection can create hidden behavior changes unless it is explicit in runtime configuration and reporting.
5. Test coverage must prove that `exec` and `sdk` backends produce equivalent review outcomes for the same inputs.

## Acceptance Criteria

- [ ] the repository has a documented `CodexRuntimeAdapter` seam
- [ ] the design keeps `exec` and `sdk` behind one repository-owned contract
- [ ] Phase 2 explicitly builds on the Phase 1 `codex exec` review path rather than replacing it blindly
- [ ] the design defines where Codex runtime metadata should live in repository-owned state
- [ ] backend-neutral normalization is called out as a first-class requirement

## Validation

- review the design against `src/orchestrator/main-orchestrator.ts`
- review the design against `src/workers/contracts.ts`
- review the design against `src/schemas/runtime.ts`
- run `git diff --check`
