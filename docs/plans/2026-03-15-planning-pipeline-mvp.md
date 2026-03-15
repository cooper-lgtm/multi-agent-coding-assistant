# Planning Pipeline MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a coherent planning pipeline that turns a request into a validated planning result and then into an execution DAG for PR2.

**Architecture:** Add a dedicated planning pipeline layer with explicit contracts, a mode resolver, a direct planner path, a debate analyzer path plus synthesis, and a normalizer that feeds the existing validator and DAG builder. Keep `PlanningController` as the facade and use deterministic mock planners/analyzers for the MVP.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing repository runtime/DAG modules

---

### Task 1: Add failing planning tests

**Files:**
- Create: `tests/planning-mode-resolution.test.mjs`
- Create: `tests/planning-pipeline.test.mjs`

**Step 1: Write the failing tests**

Add tests that expect:
- `PlanningController.resolvePlanningMode()` to resolve `auto` into direct or debate using explicit rules
- `PlanningController.createPlan()` or `PlanningPipeline.createPlan()` to produce validated direct and debate planning results
- debate synthesis to return one planning result with implementation-only tasks
- the result to be consumable by `buildExecutionDag()`

**Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/planning-mode-resolution.test.mjs tests/planning-pipeline.test.mjs`
Expected: FAIL because the planning pipeline exports and behavior do not exist yet.

### Task 2: Add planning contracts and pipeline modules

**Files:**
- Create: `src/planning/contracts.ts`
- Create: `src/planning/planning-mode-resolver.ts`
- Create: `src/planning/planning-normalizer.ts`
- Create: `src/planning/debate-synthesizer.ts`
- Create: `src/planning/mock-planners.ts`
- Create: `src/planning/planning-pipeline.ts`
- Modify: `src/planning/planning-controller.ts`
- Modify: `src/schemas/planning.ts`

**Step 1: Implement explicit planning-layer contracts**

Define requested/resolved planning modes, planner routing metadata, direct planner and debate analyzer interfaces, synthesis inputs, and planning trace metadata.

**Step 2: Implement the mode resolver**

Add deterministic `auto` resolution rules with a budget-policy escape hatch that keeps debate opt-in/off when required.

**Step 3: Implement the normalizer and synthesis path**

Normalize drafts into a final `planning result`, derive `parallel_groups`, preserve role-based trace data, and synthesize debate outputs into one merged result.

**Step 4: Implement mock planners/analyzers and the pipeline service**

Use deterministic mock role implementations for the MVP and wire them through `PlanningPipeline.createPlan()`.

**Step 5: Keep `PlanningController` as the thin facade**

Expose mode resolution, planner model selection, and the new `createPlan()` call through the controller.

### Task 3: Add fixtures and runnable planning demo

**Files:**
- Modify: `src/examples/planning-fixtures.ts`
- Create: `src/examples/run-planning-demo.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

**Step 1: Add direct and debate planning fixtures**

Provide typed request/result fixtures for direct and debate paths while preserving the existing runtime demo fixture.

**Step 2: Add a planning demo**

Demonstrate direct and debate planning, validation, and DAG conversion in a runnable script.

**Step 3: Export the new modules and add scripts**

Export the planning pipeline modules from `src/index.ts` and add a `demo:planning` script plus any targeted planning test script that improves verification.

### Task 4: Update planning prompts and docs

**Files:**
- Modify: `prompts/planning-agent.system.md`
- Modify: `prompts/planning-agent.direct.md`
- Modify: `prompts/planning-agent.debate.md`
- Modify: `prompts/architecture-planner.md`
- Modify: `prompts/engineering-planner.md`
- Modify: `prompts/integration-planner.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/prompts/prompt-strategy.md`

**Step 1: Rewrite planning prompt assets with a consistent structure**

Use sections for:
- identity / role
- responsibilities
- task / process
- input expectations
- output requirements
- constraints / failure rules
- quality criteria

**Step 2: Update repository docs**

Describe the planning pipeline layer, the new fixtures/demo, and the main verification commands.

### Task 5: Verify the PR end-to-end

**Files:**
- None

**Step 1: Run type and build verification**

Run:
- `npm run typecheck`
- `npm run build`

**Step 2: Run planning and runtime tests**

Run:
- `node --test tests/planning-mode-resolution.test.mjs tests/planning-pipeline.test.mjs`
- `node --test tests/orchestrator-runtime.test.mjs`

**Step 3: Run the planning demo**

Run: `npm run demo:planning`

**Step 4: Notify completion**

Run:
- `openclaw system event --text "Done: implemented planning pipeline MVP on feat/planning-pipeline-pr2" --mode now`
