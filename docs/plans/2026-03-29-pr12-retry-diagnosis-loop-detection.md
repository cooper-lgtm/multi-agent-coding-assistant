# PR12 Retry Diagnosis and Loop Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make retries materially smarter by carrying forward structured diagnosis and detecting repeated low-yield attempts before they become long, expensive runtime loops.

**Architecture:** Build this slice on top of the runtime middleware seam from PR35 and the checklist continuation behavior from PR11b. Extend worker/runtime contracts from a single `prior_attempt` toward a bounded attempt history plus structured diagnosis fields, then add orchestrator-owned loop detection that can attach reconsideration guidance before the next dispatch. Keep retry policy centralized in `RetryEscalationManager`; do not create a second controller or worker-owned retry strategy.

**Tech Stack:** TypeScript, Node.js built-in test runner, orchestrator runtime loop, retry manager, worker execution contracts, OpenClaw/goose worker packaging, Markdown docs

---

## Background

The runtime-success roadmap already identifies retry diagnosis and loop detection as the next step after self-verification guardrails. Today the runtime mostly carries one `prior_attempt` summary plus blocker/evidence fields. That is enough for a basic retry handoff, but not enough to recognize patterns like:
- the same blocker repeating across multiple attempts
- near-identical changed-file sets with no new verification evidence
- retries that switch models without changing strategy
- checklist continuation getting ignored repeatedly

PR12 exists to make retries adaptive instead of repetitive.

## Goal

Enable the runtime to:
- preserve bounded attempt history and structured diagnosis
- detect repeated low-yield patterns before the next retry
- tell the next worker attempt what to reconsider
- make those signals visible in runtime reporting and future trace analysis

## Non-goals

- replacing the existing retry escalation policy with free-form heuristics
- introducing unbounded raw transcript or artifact storage in task state
- letting workers decide whether a retry should happen
- implementing the structured event schema and analyzer work reserved for PR13a / PR13b

## Constraints

- `main-orchestrator` remains the only global controller
- retry decisions still flow through `RetryEscalationManager`
- loop detection is middleware-owned runtime logic, not planner logic
- worker payload additions must stay compact and portable
- history storage must be bounded and typed
- external quality gates remain evaluators, not retry policy owners

## Planning / Runtime Contract Check

- Current runtime contracts preserve rich evidence fields but only one `prior_attempt`.
- PR35 provides the middleware seam required to insert loop detection without changing global control ownership.
- PR11b should land first so checklist continuation and retry diagnosis share a coherent attempt model.
- This document intentionally recombines the breakdown's `PR12a` and `PR12b` slices into one branch-ready execution plan once that runtime base exists.
- Adapter and prompt surfaces are coupled because reconsideration guidance must reach the next worker attempt.
- This task extends runtime recovery behavior without changing planning task ownership or DAG semantics.

## Acceptance Criteria

- [ ] Runtime contracts preserve bounded attempt history plus structured diagnosis fields.
- [ ] Retry decisions can reference more than the last summary string.
- [ ] Loop detection emits deterministic reconsideration guidance before a repeated bad retry path.
- [ ] Worker payloads and prompts expose retry diagnosis clearly without bloating context.
- [ ] Runtime tests and docs surface retry-loop anti-patterns explicitly.

## Affected Modules

- `src/workers/contracts.ts`
- `src/schemas/runtime.ts`
- `src/orchestrator/retry-escalation-manager.ts`
- `src/orchestrator/loop-detection-middleware.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/orchestrator/reporting-manager.ts`
- `src/adapters/openclaw-runtime-adapter.ts`
- `src/adapters/goose-recipe-builder.ts`
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`
- `tests/orchestrator-retry-diagnostics.test.mjs`
- `tests/orchestrator-loop-detection.test.mjs`
- `tests/openclaw-runtime-adapter.test.mjs`
- `tests/goose-recipe-builder.test.mjs`
- `tests/orchestrator-runtime.test.mjs`
- `tests/orchestrator-goose-runtime.test.mjs`
- `docs/reviews/recurring-issues.md`
- `README.md`

## Risks

- history shape could become too large or too loosely structured
- loop detection could overfire on legitimate iterative work
- reconsideration guidance could drift from actual repo state
- retry budget handling could become ambiguous when continuations and retries mix

## Validation Steps

- `git diff --check`
- `npm run build`
- `node --test tests/orchestrator-retry-diagnostics.test.mjs tests/orchestrator-loop-detection.test.mjs`
- `node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`
- `node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

## Deliverables

- bounded attempt-history and diagnosis contracts
- loop-detection middleware with reconsideration guidance
- retry handoff payload threading into worker adapters/prompts
- end-to-end runtime coverage for repeated-pattern retries
- recurring-issue documentation for retry-loop anti-patterns

---

### Task 1: Add bounded attempt-history and retry-diagnosis contracts

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/retry-escalation-manager.ts`
- Create: `tests/orchestrator-retry-diagnostics.test.mjs`
- Modify: `src/index.ts`

**Step 1: Write the failing retry-diagnostics test**

Cover at minimum:
- bounded `attempt_history`
- `failure_category`
- `failure_diagnosis`
- `reconsider_instructions`
- a compact repeated-pattern summary visible to the next retry decision

**Step 2: Run the test to confirm the current gap**

Run:
`npm run build && node --test tests/orchestrator-retry-diagnostics.test.mjs`

Expected:
FAIL because the runtime only persists a single `prior_attempt`.

**Step 3: Implement the minimal bounded-history model**

Add:
- a compact, typed attempt-history structure
- diagnosis fields that distinguish blocker type from recommended next action
- retry-manager updates so decisions can reference richer state without losing the existing policy model

**Step 4: Re-run the focused retry contract test**

Run:
`npm run build && node --test tests/orchestrator-retry-diagnostics.test.mjs`

Expected:
PASS with bounded history and structured diagnosis preserved.

**Step 5: Commit**

Run:
`git add src/workers/contracts.ts src/schemas/runtime.ts src/orchestrator/retry-escalation-manager.ts tests/orchestrator-retry-diagnostics.test.mjs src/index.ts`

`git commit -m "feat: add retry diagnosis contracts"`

### Task 2: Implement orchestrator-owned loop-detection middleware

**Files:**
- Create: `src/orchestrator/loop-detection-middleware.ts`
- Create: `tests/orchestrator-loop-detection.test.mjs`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing loop-detection test**

Simulate repeated attempts with:
- the same blocker message or failure category
- near-identical changed-file sets
- no meaningful new verification evidence

Assert that the runtime emits reconsideration guidance before the next retry and records a visible loop-detection event.

**Step 2: Run the test to confirm failure**

Run:
`npm run build && node --test tests/orchestrator-loop-detection.test.mjs`

Expected:
FAIL because no loop-detection middleware exists.

**Step 3: Implement the minimal deterministic loop detector**

Combine at least:
- blocker repetition
- low-change or repeated file-change signal
- missing or unchanged verification evidence

Attach a compact reconsideration message to the task before the next dispatch rather than mutating retry ownership.

**Step 4: Re-run middleware coverage**

Run:
`npm run build && node --test tests/orchestrator-loop-detection.test.mjs tests/orchestrator-middleware.test.mjs`

Expected:
PASS with deterministic loop-detection behavior on top of the middleware seam.

**Step 5: Commit**

Run:
`git add src/orchestrator/loop-detection-middleware.ts tests/orchestrator-loop-detection.test.mjs src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/index.ts`

`git commit -m "feat: detect repeated retry loops"`

### Task 3: Thread retry diagnosis and reconsideration guidance into worker payloads

**Files:**
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `tests/openclaw-runtime-adapter.test.mjs`
- Modify: `tests/goose-recipe-builder.test.mjs`
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`

**Step 1: Add failing adapter/recipe assertions**

Require retried worker payloads to include:
- bounded attempt history
- failure diagnosis
- reconsideration instructions
- loop-detection signal when applicable

**Step 2: Run focused payload checks**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
FAIL because retry handoff payloads do not yet expose the new fields.

**Step 3: Update adapters and prompts**

Make the next worker attempt explicitly inspect the diagnosis before choosing a new plan, and report when the diagnosis no longer matches the live repo state.

**Step 4: Re-run focused payload checks**

Run:
`npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
PASS with richer retry handoff payloads.

**Step 5: Commit**

Run:
`git add src/adapters/openclaw-runtime-adapter.ts src/adapters/goose-recipe-builder.ts tests/openclaw-runtime-adapter.test.mjs tests/goose-recipe-builder.test.mjs prompts/frontend-agent.md prompts/backend-agent.md`

`git commit -m "feat: pass retry diagnosis into worker payloads"`

### Task 4: Extend end-to-end runtime coverage and recurring-issue guidance

**Files:**
- Modify: `tests/orchestrator-runtime.test.mjs`
- Modify: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `README.md`

**Step 1: Add failing integration cases**

Cover scenarios where:
- the first retry repeats the same blocker pattern and loop detection fires
- the next attempt receives reconsideration guidance and changes behavior
- reporting surfaces the diagnosis and loop signal clearly

**Step 2: Run the runtime suites to confirm they fail first**

Run:
`npm run build && node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
FAIL until loop-detection and retry diagnosis are visible end to end.

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
