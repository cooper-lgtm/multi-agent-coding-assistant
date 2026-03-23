# Runtime Success Harness Breakdown Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break the PR10-PR13 runtime-success roadmap into smaller, slice-sized implementation PRs so future sessions can start with the smallest useful change instead of re-planning PR10 from scratch.

**Architecture:** Keep the PR10-PR13 runtime-success roadmap as the high-level roadmap and add this document as the execution breakdown layer. Each slice below preserves the current repository boundaries: `main-orchestrator` remains the only global controller, planning still outputs implementation tasks only, and `test-agent` / `review-agent` remain external quality gates.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing planning/runtime schemas, OpenClaw adapters, goose-backed worker execution, Markdown plans

---

## Why This Breakdown Exists

The runtime-success roadmap currently provides the right strategic order:

1. PR10 rich context injection
2. PR11 self-verification guardrails
3. PR12 retry diagnosis and loop detection
4. PR13 structured trace analysis

That sequence is good, but the first implementation plan is still large enough that a fresh session has to choose its own “first cut” before touching code.

This breakdown fixes that by:

- defining smaller PR-sized slices
- making the first recommended slice explicit
- showing which files belong to which slice
- reducing the chance that one session tries to implement all of PR10 at once

## Breakdown Principles

Every slice below should:

- be small enough to review comfortably
- preserve current architecture boundaries
- include focused validation
- avoid coupling multiple seams when one seam is enough
- prefer schema and contract work before runtime heuristics

The repository should favor:

- low-risk contract slices first
- runtime control slices second
- heuristics and analytics slices last

## Recommended Execution Order

The recommended order is:

1. `PR10a` execution-guidance contracts and DAG propagation
2. `PR10b` runtime context builder and local discovery
3. `PR10c` worker payload threading and prompt uptake
4. `PR11a` runtime middleware seam
5. `PR11b` pre-completion checklist and continuation
6. `PR12a` retry diagnosis contracts
7. `PR12b` loop detection and retry guidance propagation
8. `PR13a` structured runtime-event schema
9. `PR13b` trace analyzer and script

If only one slice is started next, it should be **`PR10a`**.

## Detailed Slice Plan

### PR10a: Execution Guidance Contracts and DAG Propagation

**Goal:** Add `execution_guidance` to planning/runtime contracts and carry it from planning results into runtime tasks.

**Why first:** This is the lowest-risk and most foundational slice in the whole runtime-success roadmap.

**Primary files:**
- `src/schemas/planning.ts`
- `src/orchestrator/planning-validator.ts`
- `src/planning/planning-normalizer.ts`
- `src/orchestrator/dag-builder.ts`
- `src/schemas/runtime.ts`
- `src/examples/planning-fixtures.ts`
- `tests/planning-pipeline.test.mjs`
- `src/index.ts`

**What this slice should deliver:**
- new `ExecutionGuidance` contract
- planning validation and normalization support
- DAG propagation into runtime tasks
- fixtures and tests updated accordingly

**What this slice should not do:**
- no runtime context builder yet
- no adapter payload changes yet
- no prompt changes yet

**Validation target:**
- `npm run build`
- `node --test tests/planning-pipeline.test.mjs`

### PR10b: Runtime Context Builder and Local Discovery

**Goal:** Build the deterministic runtime context package that will later be sent to workers.

**Depends on:** `PR10a`

**Primary files:**
- `src/orchestrator/runtime-context-builder.ts`
- `src/orchestrator/local-context-discovery.ts`
- `tests/runtime-context-builder.test.mjs`
- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `docs/context/repo-context.md`
- `src/index.ts`

**What this slice should deliver:**
- local environment discovery helpers
- runtime context assembly from repo context, execution guidance, and retry handoff
- worker-contract fields for context payload pieces

**What this slice should not do:**
- no OpenClaw envelope changes yet
- no goose recipe changes yet
- no worker prompt changes yet

**Validation target:**
- `npm run build`
- `node --test tests/runtime-context-builder.test.mjs`

### PR10c: Worker Payload Threading and Prompt Uptake

**Goal:** Thread the new runtime context into OpenClaw/goose worker payloads and teach implementation prompts to use it.

**Depends on:** `PR10a`, `PR10b`

**Primary files:**
- `src/adapters/openclaw-runtime-adapter.ts`
- `src/adapters/goose-recipe-builder.ts`
- `tests/openclaw-runtime-adapter.test.mjs`
- `tests/goose-recipe-builder.test.mjs`
- `docs/goose/task-contract.md`
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`
- `tests/orchestrator-goose-runtime.test.mjs`
- `README.md`
- `src/index.ts`

**What this slice should deliver:**
- worker payloads carrying compact runtime context
- goose recipe inputs updated
- prompts updated to read and use injected context
- focused end-to-end coverage for context propagation

**Validation target:**
- `npm run build`
- `node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs tests/orchestrator-goose-runtime.test.mjs`

### PR11a: Runtime Middleware Seam

**Goal:** Add the minimum runtime middleware interface needed for later checklist and loop-detection logic.

**Depends on:** `PR10a`, ideally `PR10b`

**Primary files:**
- `src/orchestrator/runtime-middleware.ts`
- `tests/orchestrator-middleware.test.mjs`
- `src/orchestrator/main-orchestrator.ts`
- `src/index.ts`

**What this slice should deliver:**
- hook contracts at key runtime phases
- orchestrator integration of middleware execution
- no checklist logic yet

**Validation target:**
- `npm run build`
- `node --test tests/orchestrator-middleware.test.mjs`

### PR11b: Pre-Completion Checklist and Continuation

**Goal:** Prevent implementation workers from handing off unverified work to external quality gates.

**Depends on:** `PR10a`, `PR10b`, `PR10c`, `PR11a`

**Primary files:**
- `src/orchestrator/pre-completion-checklist-middleware.ts`
- `tests/orchestrator-precompletion-checklist.test.mjs`
- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/orchestrator/reporting-manager.ts`
- `docs/goose/task-contract.md`
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`
- `tests/orchestrator-runtime.test.mjs`
- `tests/orchestrator-goose-runtime.test.mjs`

**What this slice should deliver:**
- checklist middleware
- continuation feedback when verification is missing
- runtime behavior that loops back before external quality gates

**Validation target:**
- `npm run build`
- `node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

### PR12a: Retry Diagnosis Contracts

**Goal:** Expand retry handoff beyond one prior attempt summary.

**Depends on:** `PR11b`

**Primary files:**
- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `src/orchestrator/retry-escalation-manager.ts`
- `tests/orchestrator-retry-diagnostics.test.mjs`
- `src/index.ts`

**What this slice should deliver:**
- attempt history
- failure diagnosis
- reconsideration instructions in retry metadata

**Validation target:**
- `npm run build`
- `node --test tests/orchestrator-retry-diagnostics.test.mjs`

### PR12b: Loop Detection and Retry Guidance Propagation

**Goal:** Detect repeated failing patterns and pass explicit “change approach” signals into the next attempt.

**Depends on:** `PR12a`, `PR11a`

**Primary files:**
- `src/orchestrator/loop-detection-middleware.ts`
- `tests/orchestrator-loop-detection.test.mjs`
- `src/orchestrator/main-orchestrator.ts`
- `src/orchestrator/reporting-manager.ts`
- `src/adapters/openclaw-runtime-adapter.ts`
- `src/adapters/goose-recipe-builder.ts`
- `tests/openclaw-runtime-adapter.test.mjs`
- `tests/goose-recipe-builder.test.mjs`
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`

**What this slice should deliver:**
- loop-detection heuristics
- structured reconsideration guidance
- propagation into worker payloads and prompts

**Validation target:**
- `npm run build`
- `node --test tests/orchestrator-loop-detection.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

### PR13a: Structured Runtime-Event Schema

**Goal:** Add machine-readable runtime event structure before building an analyzer.

**Depends on:** `PR12b`

**Primary files:**
- `src/schemas/runtime.ts`
- `src/orchestrator/reporting-manager.ts`
- `src/storage/run-store.ts`
- `src/storage/file-backed-run-store.ts`
- `tests/runtime-event-schema.test.mjs`
- `src/index.ts`

**What this slice should deliver:**
- structured runtime event metadata
- persisted JSONL compatibility
- no analyzer yet

**Validation target:**
- `npm run build`
- `node --test tests/runtime-event-schema.test.mjs`

### PR13b: Trace Analyzer and Script

**Goal:** Turn structured runtime artifacts into repo-local failure summaries.

**Depends on:** `PR13a`

**Primary files:**
- `src/analysis/run-trace-analyzer.ts`
- `tests/run-trace-analyzer.test.mjs`
- `tests/fixtures/runtime-traces/sample-run-events.json`
- `scripts/analyze-run-traces.mjs`
- `package.json`
- `README.md`
- `docs/evals/known-limitations.md`
- `docs/reviews/recurring-issues.md`
- `docs/context/repo-context.md`
- `docs/context/repo-context.json`

**What this slice should deliver:**
- analyzer core
- local script
- usage docs and feedback-loop docs

**Validation target:**
- `npm run build`
- `node --test tests/run-trace-analyzer.test.mjs tests/runtime-event-schema.test.mjs`
- `node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

## What To Do In the Next Session

The next implementation session should:

1. read:
   - `README.md`
   - `PRODUCT.md`
   - `ARCHITECTURE.md`
   - `AGENTS.md`
   - `docs/roadmap/2026-03-22-runtime-success-roadmap.md`
   - `docs/plans/2026-03-22-runtime-success-harness-design.md`
   - `docs/plans/2026-03-22-pr10-rich-context-injection.md`
   - this breakdown doc
2. start with `PR10a`
3. avoid touching `runtime-context-builder`, adapters, or prompts in the first slice

## Review Guidance

Reviewers should look for:

- slices that are still too large
- hidden cross-slice coupling
- ordering that violates the current repo invariants
- any slice that weakens `test-agent` / `review-agent` boundaries
- any slice that moves orchestration policy into workers or prompts

## Final Recommendation

The PR10-PR13 runtime-success roadmap should remain the high-level roadmap.
This document should be treated as the execution entrypoint for future implementation sessions.

If there is only one immediate next action, it is:

**Implement `PR10a` first.**
