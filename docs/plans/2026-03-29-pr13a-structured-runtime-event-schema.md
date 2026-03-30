# PR13a Structured Runtime Event Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a stable, machine-readable runtime event schema so future trace analysis can reason about failures, continuations, retries, and model behavior from persisted run data instead of only human-readable log strings.

**Architecture:** Extend `RuntimeEvent` from a plain `{ timestamp, type, task_id, message }` record to a structured event envelope with typed metadata such as phase, attempt, task status, failure category, and selected model. Preserve human-readable `message` fields for debugging, but make the structured metadata the canonical analyzer surface. Keep persistence compatible with the existing JSONL event log and file-backed run store.

**Tech Stack:** TypeScript, Node.js built-in test runner, orchestrator reporting manager, runtime schemas, file-backed run persistence, JSONL event logs

---

## Background

The repository already persists runtime snapshots and event logs, but the current event structure is optimized for human inspection rather than systematic analysis. PR13a exists because PR13b, future eval scripts, and future harness tuning all depend on stable structured metadata.

Without this slice, future analyzers have to infer meaning from free-form event text, which is brittle and makes cross-run comparison difficult.

## Goal

Make runtime events capable of preserving structured metadata for:
- runtime phase
- attempt number
- task status
- failure category
- selected model
- compact event-specific fields useful to later analyzers

## Non-goals

- building the trace analyzer itself
- automatically changing harness configuration from event data
- redesigning persistence layout beyond what is needed to preserve structured events
- introducing task-operations or operator UI surfaces from later roadmap work

## Constraints

- runtime events must remain readable in raw logs
- JSONL persistence must keep working for file-backed runs
- event metadata should stay compact and typed
- event changes must not break current snapshot loading behavior
- analyzer-oriented metadata should not force the orchestrator into a second reporting system

## Planning / Runtime Contract Check

- Current `RuntimeEvent` only carries `timestamp`, `task_id`, `type`, and `message`.
- `ReportingManager.record` is the central event emission seam today.
- `FileBackedRunStore` already persists `events.jsonl`, so this slice should preserve that path rather than invent a new artifact format.
- PR13b depends on this slice; keep analyzer-specific logic out of PR13a.
- This task extends reporting and persistence contracts without changing planning/runtime ownership boundaries.

## Acceptance Criteria

- [ ] Runtime events can carry stable structured metadata alongside human-readable messages.
- [ ] File-backed JSONL persistence preserves the structured metadata round-trip.
- [ ] Focused tests lock the event schema and persistence behavior.
- [ ] Existing runtime summary behavior still works after event enrichment.
- [ ] The schema is intentionally narrow enough to support PR13b without overfitting to one analyzer.

## Affected Modules

- `src/schemas/runtime.ts`
- `src/orchestrator/reporting-manager.ts`
- `src/storage/run-store.ts`
- `src/storage/file-backed-run-store.ts`
- `tests/runtime-event-schema.test.mjs`
- `src/index.ts`

## Risks

- event metadata could become too loose and force stringly typed analyzers later
- persistence changes could silently break older run artifacts
- event schema could overfit to one planned analyzer and become awkward for future use
- summary/reporting code could accidentally ignore or duplicate enriched events

## Validation Steps

- `git diff --check`
- `npm run build`
- `node --test tests/runtime-event-schema.test.mjs`

## Deliverables

- enriched `RuntimeEvent` schema
- reporting-manager support for structured event metadata
- JSONL persistence that round-trips the new schema
- focused event-schema regression test

---

### Task 1: Write the failing structured-event schema test

**Files:**
- Create: `tests/runtime-event-schema.test.mjs`
- Verify: `src/schemas/runtime.ts`
- Verify: `src/orchestrator/reporting-manager.ts`
- Verify: `src/storage/file-backed-run-store.ts`

**Step 1: Add the failing test**

Assert that runtime events can preserve structured metadata such as:
- `phase`
- `attempt`
- `task_status`
- `failure_category`
- `model`
- a small typed metadata record for event-specific details

Also verify the file-backed JSONL event log preserves those fields.

**Step 2: Run the test to confirm the current gap**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
FAIL because runtime events only store `timestamp`, `type`, `task_id`, and `message`.

**Step 3: Commit once the failing test is checked in**

Run:
`git add tests/runtime-event-schema.test.mjs`

`git commit -m "test: add failing structured runtime event schema coverage"`

### Task 2: Enrich the runtime event schema and reporting API

**Files:**
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/index.ts`

**Step 1: Implement the minimal structured event shape**

Add a stable typed envelope that keeps `message` while also storing structured fields such as:
- event phase
- attempt number
- task status
- failure category
- selected model
- small typed metadata records

Keep the schema general enough for retries, continuations, quality gates, and future analyzers.

**Step 2: Update reporting-manager emission helpers**

Allow event recording to attach structured metadata without forcing every caller to supply it immediately.

**Step 3: Re-run the event schema test**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
still FAIL until persistence is updated to round-trip the enriched events.

**Step 4: Commit**

Run:
`git add src/schemas/runtime.ts src/orchestrator/reporting-manager.ts src/index.ts`

`git commit -m "feat: add structured runtime event schema"`

### Task 3: Preserve structured events through file-backed persistence

**Files:**
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Modify: `tests/runtime-event-schema.test.mjs`

**Step 1: Update persistence helpers**

Ensure:
- structured event objects serialize cleanly into `events.jsonl`
- load helpers preserve the metadata exactly
- manifest/runtime snapshot handling remains compatible

**Step 2: Re-run the focused event-schema test**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
PASS with structured events preserved in memory and on disk.

**Step 3: Commit**

Run:
`git add src/storage/run-store.ts src/storage/file-backed-run-store.ts tests/runtime-event-schema.test.mjs`

`git commit -m "feat: persist structured runtime events"`

### Task 4: Confirm no accidental reporting regressions

**Files:**
- Verify: `src/orchestrator/reporting-manager.ts`
- Verify: `src/schemas/runtime.ts`
- Verify: any runtime tests that touch summary behavior

**Step 1: Run the focused verification set**

Run:
`git diff --check`

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
PASS with no diff-formatting issues and stable structured event persistence.

**Step 2: Record follow-up notes for PR13b**

Document any analyzer-facing assumptions that should stay out of PR13a and be handled in the next slice.

**Step 3: Commit**

Run:
`git add docs/plans/2026-03-29-pr13a-structured-runtime-event-schema.md`

`git commit -m "docs: finalize PR13a event schema plan"`
