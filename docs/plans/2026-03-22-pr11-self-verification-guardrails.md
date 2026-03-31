# PR11 Self-Verification Guardrails Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add orchestrator-owned completion guardrails so implementation workers must demonstrate a build/verify/fix loop before external quality gates decide final completion.

**Architecture:** Introduce a runtime middleware seam and a pre-completion checklist middleware that evaluates implementation results before the task advances to external quality gates. Keep `test-agent` and `review-agent` as the final evaluators, but make the orchestrator capable of continuing a task when a worker stops too early or fails to provide expected verification evidence.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing orchestrator runtime loop, worker execution contracts, goose-backed implementation path, Markdown prompt assets

---

### Task 1: Add a runtime middleware seam

**Files:**
- Create: `src/orchestrator/runtime-middleware.ts`
- Create: `tests/orchestrator-middleware.test.mjs`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing middleware test**

Add `tests/orchestrator-middleware.test.mjs` that asserts the orchestrator can run middleware hooks at least at:
- `before_dispatch`
- `after_implementation_attempt`
- `before_quality_gates`

The test should verify that middleware can accept an implementation attempt or request continuation with additional feedback.

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs`

Expected:
FAIL because the runtime has no middleware seam yet.

**Step 3: Write the minimal middleware implementation**

Implement:
- middleware hook contracts in `src/orchestrator/runtime-middleware.ts`
- runtime integration in `src/orchestrator/main-orchestrator.ts`

Keep the seam narrow and deterministic. Do not duplicate worker logic inside the middleware framework.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs`

Expected:
PASS with middleware hooks executing in the right runtime phases.

**Step 5: Commit**

Run:
`git add src/orchestrator/runtime-middleware.ts tests/orchestrator-middleware.test.mjs src/orchestrator/main-orchestrator.ts src/index.ts`

`git commit -m "feat: add runtime middleware seam"`

### Task 2: Implement pre-completion checklist continuation

**Files:**
- Create: `src/orchestrator/pre-completion-checklist-middleware.ts`
- Create: `tests/orchestrator-precompletion-checklist.test.mjs`
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing checklist test**

Add `tests/orchestrator-precompletion-checklist.test.mjs` that covers:
- worker returns `implementation_done` without the expected verification evidence
- middleware requests task continuation instead of advancing to quality gates
- continuation feedback is stored on the task and visible to the next worker attempt
- verified implementation can proceed to external quality gates normally

**Step 2: Run test to verify it fails**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs`

Expected:
FAIL because there is no checklist middleware or continuation path yet.

**Step 3: Write the minimal checklist implementation**

Implement:
- checklist rules driven from task `execution_guidance.verification_commands`
- task-level continuation feedback fields in `src/workers/contracts.ts` / `src/schemas/runtime.ts`
- middleware logic that converts an early stop into a continuation request instead of a false handoff to quality gates
- reporting events that make checklist continuation visible in summaries and traces

Do not consume final retry escalation for a first checklist continuation unless the worker repeatedly ignores the same requirement.

**Step 4: Run test to verify it passes**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-middleware.test.mjs`

Expected:
PASS with orchestrator-owned continuation before external quality gates.

**Step 5: Commit**

Run:
`git add src/orchestrator/pre-completion-checklist-middleware.ts tests/orchestrator-precompletion-checklist.test.mjs src/workers/contracts.ts src/schemas/runtime.ts src/orchestrator/main-orchestrator.ts src/orchestrator/reporting-manager.ts src/index.ts`

`git commit -m "feat: add pre-completion checklist middleware"`

### Task 3: Strengthen worker verification protocol

**Files:**
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`
- Modify: `docs/goose/task-contract.md`
- Modify: `src/adapters/goose-recipe-builder.ts`

**Step 1: Update the failing prompt/task-contract expectations**

Adjust tests or assertions from PR10 so workers are now expected to follow a concrete protocol:
- understand task and context
- plan changes briefly
- build
- run verification
- compare against acceptance criteria
- only then return candidate completion

Use the new checklist/continuation expectations as the source of truth.

**Step 2: Run the focused tests to verify they fail**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
FAIL until prompts and goose task contract align with the new checklist behavior.

**Step 3: Update prompts and goose task contract**

Modify:
- `prompts/frontend-agent.md`
- `prompts/backend-agent.md`
- `docs/goose/task-contract.md`
- `src/adapters/goose-recipe-builder.ts`

Require workers to return verification evidence and to treat missing verification as unfinished work, not as an acceptable handoff.

**Step 4: Run tests to verify they pass**

Run:
`npm run build && node --test tests/orchestrator-precompletion-checklist.test.mjs tests/goose-recipe-builder.test.mjs`

Expected:
PASS with prompt/task-contract behavior aligned to the checklist middleware.

**Step 5: Commit**

Run:
`git add prompts/frontend-agent.md prompts/backend-agent.md docs/goose/task-contract.md src/adapters/goose-recipe-builder.ts`

`git commit -m "docs: require worker self-verification before handoff"`

### Task 4: Extend end-to-end runtime coverage

**Files:**
- Modify: `tests/orchestrator-runtime.test.mjs`
- Modify: `tests/orchestrator-goose-runtime.test.mjs`
- Modify: `README.md`

**Step 1: Add end-to-end failing cases**

Update runtime tests to cover:
- worker stops early and receives checklist continuation
- worker complies on the next attempt and then passes to quality gates
- external quality gates still remain the final owner of `completed` vs `needs_fix`

**Step 2: Run tests to verify they fail**

Run:
`npm run build && node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
FAIL until the runtime loop handles continuation correctly.

**Step 3: Finish integration updates**

Adjust the runtime loop and README notes as needed so the documented behavior matches the actual continuation flow.

**Step 4: Run the focused verification set**

Run:
`npm run build && node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs`

Expected:
PASS with self-verification guardrails active and external quality gates preserved.

**Step 5: Commit**

Run:
`git add tests/orchestrator-runtime.test.mjs tests/orchestrator-goose-runtime.test.mjs README.md src/orchestrator/main-orchestrator.ts`

`git commit -m "test: cover self-verification continuation flow"`
