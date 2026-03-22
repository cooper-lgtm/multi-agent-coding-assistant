# PR12 Retry Diagnosis and Loop Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make retries materially smarter by carrying structured failure diagnosis forward and detecting repeated low-yield attempts before they turn into long runtime loops.

**Architecture:** Extend task/runtime state with compact attempt history and diagnosis fields, add orchestrator-owned loop-detection middleware, and thread reconsideration guidance into retry handoff payloads. Preserve the existing retry/escalation policy model while making each retry better informed.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing retry manager, runtime middleware seam, OpenClaw worker envelopes, goose recipe packaging

---

### Task 1: Add attempt-history and retry-diagnosis contracts

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/retry-escalation-manager.ts`
- Create: `tests/orchestrator-retry-diagnostics.test.mjs`
- Modify: `src/index.ts`

**Step 1: Write the failing retry-diagnostics test**

Add `tests/orchestrator-retry-diagnostics.test.mjs` that asserts retries can preserve:
- `attempt_history`
- `failure_category`
- `failure_diagnosis`
- `reconsider_instructions`
- compact repeated-pattern metadata

The test should confirm the next retry decision has access to more than the previous summary string.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/orchestrator-retry-diagnostics.test.mjs`

Expected:
FAIL because task/runtime contracts only preserve a single `prior_attempt`.

**Step 3: Write the minimal retry-diagnosis implementation**

Implement:
- compact attempt-history support in task/runtime contracts
- diagnosis fields in `src/workers/contracts.ts`
- retry-manager updates in `src/orchestrator/retry-escalation-manager.ts` so decisions can reference the richer history

Keep the history bounded; do not store unbounded raw outputs.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/orchestrator-retry-diagnostics.test.mjs`

Expected:
PASS with bounded attempt history and structured retry diagnosis.

**Step 5: Commit**

Run:
`git add src/workers/contracts.ts src/schemas/runtime.ts src/orchestrator/retry-escalation-manager.ts tests/orchestrator-retry-diagnostics.test.mjs src/index.ts`

`git commit -m "feat: add retry diagnosis contracts"`

### Task 2: Implement loop-detection middleware

**Files:**
- Create: `src/orchestrator/loop-detection-middleware.ts`
- Create: `tests/orchestrator-loop-detection.test.mjs`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing loop-detection test**

Add `tests/orchestrator-loop-detection.test.mjs` that simulates repeated attempts with:
- the same blocker message
- near-identical changed-file sets
- no new verification evidence

Assert that middleware emits reconsideration guidance and records a visible loop-detection event before the next retry.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/orchestrator-loop-detection.test.mjs`

Expected:
FAIL because no loop-detection middleware exists.

**Step 3: Write the minimal loop-detection implementation**

Implement:
- a loop-detection middleware that inspects recent attempt history
- reconsideration guidance attached to the task before the next dispatch
- reporting events that identify the detected loop signature

Do not overfit to one signal; combine at least blocker repetition plus low-change/no-verification evidence.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/orchestrator-loop-detection.test.mjs tests/orchestrator-middleware.test.mjs`

Expected:
PASS with deterministic loop-detection behavior.

**Step 5: Commit**

Run:
`git add src/orchestrator/loop-detection-middleware.ts tests/orchestrator-loop-detection.test.mjs src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/index.ts`

`git commit -m "feat: detect repeated retry loops"`

### Task 3: Thread diagnosis into worker payloads and prompts

**Files:**
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `tests/openclaw-runtime-adapter.test.mjs`
- Modify: `tests/goose-recipe-builder.test.mjs`
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`

**Step 1: Write the failing adapter assertions**

Update adapter/recipe tests so retried worker payloads must include:
- compact attempt history
- failure diagnosis
- reconsideration instructions
- loop-detection signal when applicable

**Step 2: Run tests to verify they fail**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
FAIL because retry payloads do not yet include the new fields.

**Step 3: Update adapters and prompts**

Implement payload threading in:
- `src/adapters/openclaw-runtime-adapter.ts`
- `src/adapters/goose-recipe-builder.ts`

Update prompts so workers:
- inspect the diagnosis before choosing a new plan
- avoid replaying the flagged failed strategy
- report when the diagnosis itself appears inconsistent with the repo state

**Step 4: Run tests to verify they pass**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
PASS with richer retry handoff payloads.

**Step 5: Commit**

Run:
`git add src/adapters/openclaw-runtime-adapter.ts src/adapters/goose-recipe-builder.ts tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs prompts/frontend-agent.md prompts/backend-agent.md`

`git commit -m "feat: pass retry diagnosis into worker payloads"`

### Task 4: Extend integration coverage and recurring-issue docs

**Files:**
- Modify: `tests/orchestrator-runtime.test.mjs`
- Modify: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `README.md`

**Step 1: Add failing integration cases**

Cover scenarios where:
- the first retry repeats the same blocker pattern and middleware flags a loop
- the second retry receives reconsideration guidance and changes behavior
- reporting surfaces the diagnosis clearly in summaries

**Step 2: Run tests to verify they fail**

Run:
`npm run build && node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
FAIL until loop-detection and retry diagnosis are visible end-to-end.

**Step 3: Finish docs and integration wiring**

Update:
- runtime tests
- `docs/reviews/recurring-issues.md` with retry-loop anti-patterns
- `README.md` with the new retry-diagnosis surface

**Step 4: Run the focused verification set**

Run:
`npm run build && node --test tests/orchestrator-retry-diagnostics.test.mjs tests/orchestrator-loop-detection.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
PASS with adaptive retry handoffs and visible loop-detection reporting.

**Step 5: Commit**

Run:
`git add tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs docs/reviews/recurring-issues.md README.md`

`git commit -m "test: cover retry diagnosis and loop detection"`
