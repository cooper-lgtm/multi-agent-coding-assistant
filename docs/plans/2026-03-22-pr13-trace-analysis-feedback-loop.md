# PR13 Trace Analysis Feedback Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured runtime-event analysis so future harness iterations can be driven by repo-local evidence from persisted runs.

**Architecture:** Enrich runtime events with stable structured metadata, preserve that metadata in persisted artifacts, and add a repository-local analyzer plus script that summarizes common blocker categories, verification failures, retry loops, and other recurring run patterns. Keep the analyzer read-only with respect to runtime execution.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing run-store persistence, JSONL event logs, Node CLI script, Markdown docs

---

### Task 1: Enrich runtime-event schema and persistence

**Files:**
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Create: `tests/runtime-event-schema.test.mjs`
- Modify: `src/index.ts`

**Step 1: Write the failing runtime-event test**

Add `tests/runtime-event-schema.test.mjs` that asserts runtime events can store structured metadata such as:
- `phase`
- `attempt`
- `task_status`
- `failure_category`
- `model`
- small typed metadata records useful to later analysis

The test should verify the JSONL event log preserves the structured fields.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
FAIL because runtime events only store `timestamp`, `type`, `task_id`, and `message`.

**Step 3: Write the minimal event-schema implementation**

Update:
- `src/schemas/runtime.ts`
- `src/orchestrator/reporting-manager.ts`
- persistence helpers in `src/storage/run-store.ts` and `src/storage/file-backed-run-store.ts`

Keep message strings for human readability, but make the structured fields the stable analyzer surface.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs`

Expected:
PASS with structured events preserved in memory and on disk.

**Step 5: Commit**

Run:
`git add src/schemas/runtime.ts src/orchestrator/reporting-manager.ts src/storage/run-store.ts src/storage/file-backed-run-store.ts tests/runtime-event-schema.test.mjs src/index.ts`

`git commit -m "feat: add structured runtime event schema"`

### Task 2: Build the run-trace analyzer core

**Files:**
- Create: `src/analysis/run-trace-analyzer.ts`
- Create: `tests/run-trace-analyzer.test.mjs`
- Create: `tests/fixtures/runtime-traces/sample-run-events.json`
- Modify: `src/index.ts`

**Step 1: Write the failing analyzer test**

Add `tests/run-trace-analyzer.test.mjs` that feeds sample structured events into the analyzer and expects summaries for:
- common blocker categories
- checklist continuation counts
- loop-detection occurrences
- retry-escalation hot spots
- models most associated with failure categories in the sample input

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/run-trace-analyzer.test.mjs`

Expected:
FAIL because no analyzer module exists.

**Step 3: Write the minimal analyzer implementation**

Implement:
- a read-only analyzer in `src/analysis/run-trace-analyzer.ts`
- stable summarized output for the categories above
- fixture input under `tests/fixtures/runtime-traces/sample-run-events.json`

Avoid trying to automatically mutate harness configuration in this PR.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/run-trace-analyzer.test.mjs`

Expected:
PASS with deterministic analyzer summaries.

**Step 5: Commit**

Run:
`git add src/analysis/run-trace-analyzer.ts tests/run-trace-analyzer.test.mjs tests/fixtures/runtime-traces/sample-run-events.json src/index.ts`

`git commit -m "feat: add run trace analyzer"`

### Task 3: Add a repository-local analyzer script

**Files:**
- Create: `scripts/analyze-run-traces.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/evals/known-limitations.md`

**Step 1: Write the failing script test or harness check**

If the repository already tests script behavior directly, add a focused script test under `tests/`.
Otherwise, write a minimal deterministic invocation check that runs the script against fixture data and verifies exit code plus summary headings.

Recommended file if needed:
- Create: `tests/analyze-run-traces.test.mjs`

**Step 2: Run the check to verify it fails**

Run:
`npm run build && node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Expected:
FAIL because the script does not exist yet.

**Step 3: Write the minimal script implementation**

Implement:
- a CLI script that reads persisted run artifacts or fixture directories
- analyzer invocation plus human-readable markdown/text summary
- one package script such as `npm run analyze:traces`

Update docs so future sessions know how to run it.

**Step 4: Run the check to verify it passes**

Run:
`npm run build && node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Expected:
PASS with a stable summary of the fixture run data.

**Step 5: Commit**

Run:
`git add scripts/analyze-run-traces.mjs package.json README.md docs/evals/known-limitations.md`

`git commit -m "feat: add trace analysis script"`

### Task 4: Tie analyzer output back into repository review workflow

**Files:**
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `docs/context/repo-context.md`
- Modify: `docs/context/repo-context.json`
- Modify: `README.md`

**Step 1: Update the failing documentation expectations**

Add or adjust checks so the repo context and recurring-review docs reflect:
- the existence of structured trace analysis
- how to inspect recurring harness failures after a run
- where analyzer results should influence future plan docs

**Step 2: Run docs verification**

Run:
`git diff --check`

Expected:
no output

**Step 3: Finish the workflow docs**

Document:
- when to run the analyzer
- where the analyzer sits relative to manual code review and evals
- how to turn findings into future plan docs instead of leaving them in chat

**Step 4: Run the focused verification set**

Run:
`npm run build && node --test tests/runtime-event-schema.test.mjs tests/run-trace-analyzer.test.mjs`

Run:
`node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Run:
`git diff --check`

Expected:
all checks PASS with no diff-formatting issues.

**Step 5: Commit**

Run:
`git add docs/reviews/recurring-issues.md docs/context/repo-context.md docs/context/repo-context.json README.md`

`git commit -m "docs: wire trace analysis into review workflow"`

