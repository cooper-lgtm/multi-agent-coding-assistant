# Planning Brief Coordination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a coordinator-led planning and bounded triad-review protocol that replaces free-form multi-agent dialogue with structured, testable interaction traces.

**Architecture:** Add a frozen `ClarifiedPlanningBrief` artifact to the planning pipeline, route all user-facing clarification through `planning-agent`, and let debate analyzers return structured analysis plus optional clarification or cross-review outputs. Keep triad review inside the logical `review-agent` quality gate and verify the new behavior with deterministic fixtures, trace snapshots, and focused runtime tests.

**Tech Stack:** TypeScript, Node test runner, existing planning/runtime schemas, deterministic mock planners, golden-style fixtures

---

### Task 1: Add the planning coordination schemas and trace types

**Files:**
- Modify: `src/schemas/planning.ts`
- Modify: `src/planning/contracts.ts`
- Test: `tests/planning-pipeline.test.mjs`

**Step 1: Write the failing test**

```js
test('debate planning trace records the planning coordinator and clarified brief metadata', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan(buildDebatePlanningFixtureRequest());

  assert.equal(planningResult.planning_trace?.planner_routes[0]?.role, 'planning-agent');
  assert.equal(planningResult.planning_trace?.clarified_brief?.version, 1);
  assert.equal(planningResult.planning_trace?.debate?.length, 3);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:planning`
Expected: FAIL because `planning_trace.clarified_brief` does not exist and debate mode does not record `planning-agent`.

**Step 3: Write minimal implementation**

Add schema types for:
- `ClarifiedPlanningBrief`
- `PlanningClarificationRequest`
- bounded planner cross-review metadata

Wire them through:
- `PlanningTrace`
- `PlanningPipelineContext`
- `DebateAnalyzerInput`
- `DebateAnalysis`
- `PlanningNormalizationInput`

```ts
export interface ClarifiedPlanningBrief {
  version: number;
  request_summary: string;
  goals: string[];
  non_goals: string[];
  constraints: string[];
  assumptions: string[];
  known_risks: string[];
  unresolved_questions: string[];
  ready_for_planning: boolean;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:planning`
Expected: PASS for the new planning trace assertions or fail later on the next missing coordinator behavior.

**Step 5: Commit**

```bash
git add src/schemas/planning.ts src/planning/contracts.ts tests/planning-pipeline.test.mjs
git commit -m "feat: add planning coordination schema"
```

### Task 2: Make `planning-agent` the real debate coordinator

**Files:**
- Modify: `src/planning/planning-pipeline.ts`
- Modify: `src/planning/planning-controller.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Test: `tests/planning-pipeline.test.mjs`
- Test: `src/examples/planning-fixtures.ts`

**Step 1: Write the failing test**

```js
test('debate planning uses planning-agent as the formal coordinator', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const result = await controller.createPlan(buildDebatePlanningFixtureRequest());
  const routeRoles = result.planning_trace?.planner_routes.map((route) => route.role);

  assert.deepEqual(routeRoles, [
    'planning-agent',
    'architecture-planner',
    'engineering-planner',
    'integration-planner',
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:planning`
Expected: FAIL because current debate planning records only the three analyzer routes.

**Step 3: Write minimal implementation**

Update debate flow so it:
- resolves a coordinator route for `planning-agent`
- creates a clarified brief before analyzer fan-out
- passes the same brief to all analyzers
- includes the coordinator route when normalizing the final trace

```ts
const coordinatorRoute = toPlannerRoute(this.router.route('planning-agent', { availableModels }));
const clarifiedBrief = this.dependencies.briefBuilder.build({ request, resolved_mode: resolvedMode });

const analyses = await Promise.all(
  roles.map((role) =>
    this.dependencies.analyzers[role].analyze({
      request,
      resolved_mode: resolvedMode,
      available_models: availableModels,
      role,
      planner_route: toPlannerRoute(this.router.route(role, { availableModels })),
      clarified_brief: clarifiedBrief,
    }),
  ),
);
```

**Step 4: Run test to verify it passes**

Run: `npm run test:planning`
Expected: PASS for coordinator route ordering and fixture alignment updates.

**Step 5: Commit**

```bash
git add src/planning/planning-pipeline.ts src/planning/planning-controller.ts src/planning/planning-normalizer.ts src/examples/planning-fixtures.ts tests/planning-pipeline.test.mjs
git commit -m "feat: make planning-agent coordinate debate planning"
```

### Task 3: Add structured clarification and bounded planner cross-review

**Files:**
- Modify: `src/planning/contracts.ts`
- Modify: `src/planning/mock-planners.ts`
- Modify: `src/planning/debate-synthesizer.ts`
- Test: `tests/planning-pipeline.test.mjs`
- Create: `tests/fixtures/planning/debate-coordination-golden.json`

**Step 1: Write the failing test**

```js
test('debate analyzers can request clarification and emit one bounded cross-review round', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const result = await controller.createPlan({
    ...buildDebatePlanningFixtureRequest(),
    existing_artifacts: ['fixture:analyzer-clarification', 'fixture:cross-review-conflict'],
  });

  assert.equal(result.planning_trace?.clarification_rounds, 1);
  assert.equal(result.planning_trace?.cross_review_rounds, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:planning`
Expected: FAIL because analyzers do not yet emit clarification or cross-review metadata.

**Step 3: Write minimal implementation**

Extend analyzer outputs with:
- `clarification_requests`
- `cross_review_findings`

Keep the protocol bounded:
- zero or one clarification round
- zero or one cross-review round
- no free-form peer chat

```ts
export interface PlannerCrossReviewFinding {
  reviewer: DebatePlannerRoleName;
  target: DebatePlannerRoleName;
  disposition: 'agree' | 'disagree' | 'missing_risk' | 'missing_dependency' | 'ownership_concern';
  evidence: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:planning`
Expected: PASS, with a new golden fixture capturing the bounded interaction trace.

**Step 5: Commit**

```bash
git add src/planning/contracts.ts src/planning/mock-planners.ts src/planning/debate-synthesizer.ts tests/planning-pipeline.test.mjs tests/fixtures/planning/debate-coordination-golden.json
git commit -m "feat: add bounded planner clarification and cross-review"
```

### Task 4: Refresh prompts and examples to match the coordinator protocol

**Files:**
- Modify: `prompts/planning-agent.system.md`
- Modify: `prompts/planning-agent.debate.md`
- Modify: `prompts/architecture-planner.md`
- Modify: `prompts/engineering-planner.md`
- Modify: `prompts/integration-planner.md`
- Modify: `src/examples/run-planning-demo.ts`
- Test: `tests/orchestrator-e2e.test.mjs`

**Step 1: Write the failing test**

```js
test('debate planning fixture stays aligned with the coordination golden snapshot', () => {
  const golden = loadJsonFixture('planning', 'debate-coordination-golden.json');
  assert.deepEqual(buildDebatePlanningFixture(), golden);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL because the fixture and prompts still reflect analyzer-only synthesis.

**Step 3: Write minimal implementation**

Update prompts so they clearly say:
- `planning-agent` is the only user-facing planner
- analyzers may return clarification requests, not direct user questions
- cross-review is bounded and structured

Update the demo to print:
- clarified brief version
- coordinator route
- analyzer routes
- clarification/cross-review round counts

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS with the new planning golden fixture.

**Step 5: Commit**

```bash
git add prompts/planning-agent.system.md prompts/planning-agent.debate.md prompts/architecture-planner.md prompts/engineering-planner.md prompts/integration-planner.md src/examples/run-planning-demo.ts tests/orchestrator-e2e.test.mjs
git commit -m "docs: align planning prompts with coordination protocol"
```

### Task 5: Add triad-review internal findings without changing the top-level quality gate contract

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `prompts/review-agent.md`
- Test: `tests/orchestrator-runtime.test.mjs`

**Step 1: Write the failing test**

```js
test('triad review stays inside one logical review-agent decision', async () => {
  const fixture = buildDemoPlanningFixture();
  const runner = new MockQualityGateRunner({
    taskDecisions: {
      [fixture.tasks[0].id]: [
        {
          status: 'needs_fix',
          summary: 'Blocking review finding survived coordination.',
          test_status: 'pass',
          review_status: 'needs_fix',
          review_findings: [
            { reviewer: 'review-agent', severity: 'high', disposition: 'blocking', evidence: 'Null handoff path is untested.' },
          ],
        },
      ],
    },
  });

  const result = await runner.run(/* existing task/runtime fixture */);
  assert.equal(result.review_status, 'needs_fix');
  assert.equal(result.roles.includes('review-agent'), true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:runtime`
Expected: FAIL because `review_findings` do not exist and the runner only returns flat feedback strings.

**Step 3: Write minimal implementation**

Add internal structured review findings while preserving:
- one logical `review-agent` result to the orchestrator
- existing `review_feedback` summary strings for retry handoff

```ts
export interface ReviewFinding {
  reviewer: string;
  severity: 'low' | 'medium' | 'high';
  disposition: 'advisory' | 'blocking' | 'contested';
  evidence: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:runtime`
Expected: PASS, with triad-review evidence preserved but no new top-level DAG owner introduced.

**Step 5: Commit**

```bash
git add src/workers/contracts.ts src/schemas/runtime.ts src/orchestrator/quality-gate-runner.ts prompts/review-agent.md tests/orchestrator-runtime.test.mjs
git commit -m "feat: add internal triad review findings"
```

### Task 6: Add a deterministic interaction harness and evaluation matrix

**Files:**
- Create: `tests/planning-coordination-harness.test.mjs`
- Create: `tests/fixtures/planning/debate-clarification-golden.json`
- Create: `tests/fixtures/planning/debate-cross-review-golden.json`
- Modify: `docs/evals/known-limitations.md`
- Modify: `README.md`

**Step 1: Write the failing test**

```js
test('planning coordination harness replays clarification and cross-review deterministically', async () => {
  const trace = await runPlanningCoordinationHarness('cross-review-conflict');
  const golden = loadJsonFixture('planning', 'debate-cross-review-golden.json');

  assert.deepEqual(trace, golden);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/planning-coordination-harness.test.mjs`
Expected: FAIL because the harness and golden fixtures do not exist yet.

**Step 3: Write minimal implementation**

Build a deterministic harness that:
- injects scripted analyzer outputs
- records interaction trace events
- compares against golden fixtures

Document in `docs/evals/known-limitations.md` that:
- live model quality is still a separate eval problem
- this harness verifies protocol compliance and recoverability first

**Step 4: Run test to verify it passes**

Run: `node --test tests/planning-coordination-harness.test.mjs`
Expected: PASS for clarification and cross-review replay scenarios.

**Step 5: Commit**

```bash
git add tests/planning-coordination-harness.test.mjs tests/fixtures/planning/debate-clarification-golden.json tests/fixtures/planning/debate-cross-review-golden.json docs/evals/known-limitations.md README.md
git commit -m "test: add planning coordination interaction harness"
```

### Task 7: Run full targeted verification and publish implementation notes

**Files:**
- Modify: `docs/reviews/recurring-issues.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md`

**Step 1: Run the focused verification set**

Run: `npm run test:planning`
Expected: PASS

Run: `npm run test:runtime`
Expected: PASS

Run: `npm run test:e2e`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `git diff --check`
Expected: no output

**Step 2: Write final doc updates**

Capture the new invariants:
- only `planning-agent` may perform user-facing planning clarification
- planner cross-review is bounded and structured
- triad review remains internal to the logical `review-agent`
- deterministic interaction harnesses are the primary regression surface

**Step 3: Re-run doc and test verification**

Run: `npm run test:planning && npm run test:runtime && npm run test:e2e`
Expected: PASS

Run: `git diff --check`
Expected: no output

**Step 4: Commit**

```bash
git add docs/reviews/recurring-issues.md ARCHITECTURE.md AGENTS.md
git commit -m "docs: record planning and review coordination invariants"
```
