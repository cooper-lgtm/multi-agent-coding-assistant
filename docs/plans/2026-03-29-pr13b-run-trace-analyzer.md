# PR13b Run Trace Analyzer and Feedback Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn persisted run artifacts into repository-local feedback by adding a deterministic run-trace analyzer, a CLI script, and workflow documentation that shows how analyzer findings should inform future harness changes.

**Architecture:** Build this slice on top of PR13a's structured runtime event schema. Add a read-only analyzer module that consumes persisted event data and summarizes recurring failure modes such as checklist continuations, retry loops, blocker categories, and model-linked failure hotspots. Package that analyzer behind a local CLI script, then connect the output back into repository review and planning workflow docs.

**Tech Stack:** TypeScript, Node.js built-in test runner, runtime event schema, file-backed run artifacts, Node CLI scripts, Markdown docs

---

## Background

The repository already persists run artifacts and has a roadmap goal of making harness iteration data-driven. PR13a creates the structured event surface; PR13b exists to make that surface operational.

Without this slice, persisted traces remain mostly forensic artifacts that humans inspect manually. The repository needs a repeatable way to extract common failure patterns and feed them back into future plan docs, reviews, and harness changes.

## Goal

Provide a repo-local analyzer workflow that can:
- summarize recurring blocker categories
- count checklist continuations and retry-loop signals
- highlight models most associated with failure categories in sample data
- provide a stable CLI entry point for post-run analysis
- document how analyzer output should shape future harness planning

## Non-goals

- automatically rewriting prompts, policies, or roadmap docs from analyzer output
- mutating runtime state after a run completes
- introducing remote dashboards or task-operations UI
- expanding persistence layout beyond what PR13a already established

## Constraints

- PR13a must land first or this slice must be retargeted onto a branch that already contains the structured event schema
- analyzer output must stay deterministic for test fixtures
- analyzer remains read-only with respect to runtime execution
- workflow docs should explain how to use analyzer findings without turning them into automatic policy changes
- script usage should remain repo-local and not require hosted infrastructure

## Planning / Runtime Contract Check

- PR13a defines the structured event surface this analyzer consumes.
- Existing file-backed run artifacts already provide `runtime.json`, `manifest.json`, and `events.jsonl`.
- `docs/reviews/recurring-issues.md` and `docs/context/repo-context.*` are the correct docs surfaces for feeding analyzer results back into the repository.
- This task adds analysis tooling and workflow guidance without changing runtime control ownership.

## Acceptance Criteria

- [ ] A deterministic analyzer module can summarize structured runtime events from fixture data.
- [ ] A repository-local script can run the analyzer against persisted artifacts.
- [ ] Analyzer output covers the main failure patterns called out in the runtime-success roadmap.
- [ ] Workflow docs explain when to run the analyzer and how to turn findings into future plan work.
- [ ] The analyzer remains read-only and does not mutate harness configuration.

## Affected Modules

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
- `src/index.ts`

## Risks

- analyzer summaries could overfit to current event names and become brittle
- script UX could be too ad hoc for future sessions to reuse consistently
- workflow docs could imply analyzer findings are automatically authoritative
- sample fixtures could be too shallow and miss real failure patterns

## Validation Steps

- `git diff --check`
- `npm run build`
- `node --test tests/run-trace-analyzer.test.mjs`
- `node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

## Deliverables

- run-trace analyzer module
- deterministic analyzer fixture and test coverage
- local CLI script and package entry point
- workflow docs that connect analysis results back into future harness planning

---

### Task 1: Write the failing run-trace analyzer test

**Files:**
- Create: `src/analysis/run-trace-analyzer.ts`
- Create: `tests/run-trace-analyzer.test.mjs`
- Create: `tests/fixtures/runtime-traces/sample-run-events.json`
- Modify: `src/index.ts`

**Step 1: Add the failing analyzer test**

Feed structured sample events into the analyzer and expect summaries for:
- common blocker categories
- checklist continuation counts
- loop-detection occurrences
- retry-escalation hotspots
- models most associated with failure categories

**Step 2: Run the test to confirm the current gap**

Run:
`npm run build && node --test tests/run-trace-analyzer.test.mjs`

Expected:
FAIL because no analyzer module exists yet.

**Step 3: Commit the failing test and fixture scaffold**

Run:
`git add tests/run-trace-analyzer.test.mjs tests/fixtures/runtime-traces/sample-run-events.json`

`git commit -m "test: add failing run trace analyzer coverage"`

### Task 2: Implement the minimal read-only analyzer core

**Files:**
- Create: `src/analysis/run-trace-analyzer.ts`
- Modify: `src/index.ts`
- Modify: `tests/run-trace-analyzer.test.mjs`

**Step 1: Implement deterministic analyzer summaries**

Summarize at least:
- blocker frequencies
- checklist continuation counts
- retry-loop occurrences
- model/failure-category correlations in the sample input

Keep the analyzer read-only and avoid any automatic policy mutation.

**Step 2: Re-run focused analyzer tests**

Run:
`npm run build && node --test tests/run-trace-analyzer.test.mjs`

Expected:
PASS with deterministic analyzer summaries.

**Step 3: Commit**

Run:
`git add src/analysis/run-trace-analyzer.ts tests/run-trace-analyzer.test.mjs src/index.ts`

`git commit -m "feat: add run trace analyzer"`

### Task 3: Add a repository-local analyzer script

**Files:**
- Create: `scripts/analyze-run-traces.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/evals/known-limitations.md`

**Step 1: Write the failing script invocation check**

If no script test exists, add a minimal deterministic invocation harness or at minimum verify direct script execution against fixture data.

Run:
`npm run build && node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Expected:
FAIL because the script does not exist yet.

**Step 2: Implement the minimal script**

Provide:
- a CLI that reads fixture or persisted run directories
- analyzer invocation
- stable text/markdown summary output
- a package script such as `npm run analyze:traces`

**Step 3: Re-run the script check**

Run:
`npm run build && node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Expected:
PASS with a stable summary from the fixture input.

**Step 4: Commit**

Run:
`git add scripts/analyze-run-traces.mjs package.json README.md docs/evals/known-limitations.md`

`git commit -m "feat: add trace analysis script"`

### Task 4: Wire analyzer output back into repository workflow docs

**Files:**
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `docs/context/repo-context.md`
- Modify: `docs/context/repo-context.json`
- Modify: `README.md`

**Step 1: Update workflow docs**

Document:
- when to run the analyzer
- where analyzer output fits relative to review and eval work
- how to turn findings into future plan docs instead of leaving them in chat

**Step 2: Run the focused verification set**

Run:
`git diff --check`

Run:
`npm run build && node --test tests/run-trace-analyzer.test.mjs`

Run:
`node scripts/analyze-run-traces.mjs --state-dir tests/fixtures/runtime-traces`

Expected:
PASS with no diff-formatting issues.

**Step 3: Commit**

Run:
`git add docs/reviews/recurring-issues.md docs/context/repo-context.md docs/context/repo-context.json README.md`

`git commit -m "docs: wire trace analysis into review workflow"`
