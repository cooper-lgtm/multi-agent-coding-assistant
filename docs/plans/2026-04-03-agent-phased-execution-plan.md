# Agent Capability Phased Execution Implementation Plan

**Goal:** Evolve the repository from a strong orchestration kernel into a stronger day-to-day agent system by delivering four ordered capability phases through one Goose-executable task list.

**Architecture:** Keep `main-orchestrator` as the only global controller, keep planning outputs implementation-only, and continue using task-sized PRs as the execution unit. Use one total plan document with four ordered phases so Goose can keep looping on `### Task N:` items while humans still see phase-level roadmap structure.

**Tech Stack:** TypeScript, Node.js built-in test runner, Goose recipes, OpenClaw adapters, Markdown plans, existing planning/runtime schemas and prompts

---

## Background

- The repository already has a validated orchestration kernel, runtime context injection, pre-completion checklist continuation, retry diagnostics, loop detection, and run-trace analysis in the current baseline, so the next iteration should expand agent capability instead of rebuilding the kernel from scratch. Evidence: [README.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/README.md), [docs/harness-engineering-v2.1-report.zh-CN.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/harness-engineering-v2.1-report.zh-CN.md#L122), [docs/context/repo-context.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/context/repo-context.md).
- Debate planning still fans out directly to `architecture-planner`, `engineering-planner`, and `integration-planner` without a real `planning-agent` coordination step, so Phase 1 should align code with the existing coordination design before later workflow layers build on it. Evidence: [src/planning/planning-pipeline.ts:104](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/src/planning/planning-pipeline.ts#L104), [docs/plans/2026-03-17-planning-brief-coordination.md:5](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/plans/2026-03-17-planning-brief-coordination.md#L5).
- Worker handoff is already richer than a bare prompt, but it is still centered on loose fields such as `runtime_context`, `attempt_history`, `commands_run`, and `review_feedback`; there is no explicit attempt-level `TaskExecutionContract`, `implementation_attempt_report`, `qa_report`, or `retry_diagnosis_report` artifact yet. Evidence: [src/workers/contracts.ts:67](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/src/workers/contracts.ts#L67), [src/workers/contracts.ts:83](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/src/workers/contracts.ts#L83), [docs/harness-engineering-v2.1-report.zh-CN.md:152](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/harness-engineering-v2.1-report.zh-CN.md#L152).
- `review-agent` and `test-agent` prompts are intentionally thin today, returning only coarse decisions with concise evidence, so Phase 3 should deepen them only after Phase 2 provides stronger artifact surfaces. Evidence: [prompts/review-agent.md:1](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/prompts/review-agent.md#L1), [prompts/test-agent.md:1](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/prompts/test-agent.md#L1).
- Task operations and stage discipline are explicitly described as future extensions rather than current code-level capabilities, so Phase 4 should start with a narrow design-to-scaffold path instead of jumping straight to a large task registry. Evidence: [docs/harness-engineering-v2.1-report.zh-CN.md:130](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/harness-engineering-v2.1-report.zh-CN.md#L130), [docs/harness-engineering-v2.1-report.zh-CN.md:152](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/harness-engineering-v2.1-report.zh-CN.md#L152).

## Goal

- Deliver a single Goose-executable roadmap for the next agent version.
- Keep the roadmap in one document with four ordered phases and multiple `### Task N:` slices.
- Make each task small enough to fit the existing branch -> develop -> self-test -> review loop -> PR -> checks -> merge workflow.

## Non-goals

- Do not redesign `main-orchestrator` into a multi-controller runtime.
- Do not change planning outputs so quality-gate roles become task owners.
- Do not require a separate JSON conversion layer just to make Goose consume this plan.
- Do not jump directly to a large task registry or full operator platform in this version.
- Do not force all tasks into a compressed task format when the execution path benefits from explicit steps.

## Constraints

- Keep `main-orchestrator` as the only global controller.
- Keep planning outputs implementation-only; `assigned_agent` may only be `frontend-agent` or `backend-agent`.
- Keep `test-agent` and `review-agent` as post-implementation evaluators, not planning owners.
- Preserve the distinct meanings of `needs_fix`, `blocked`, and `failed`.
- Preserve logical model routing plus exact `model_metadata` when available.
- Keep this plan as one total document because the current Goose execution flow is centered on a single `plan_path`.
- Keep the current expanded task shape where order and handoff quality matter, even while the document as a whole aligns to the new template.

## Planning / Runtime Contract Check

- Current schemas already define typed planning and runtime baselines in `src/schemas/planning.ts`, `src/schemas/runtime.ts`, and `src/workers/contracts.ts`, but they do not yet cover the clarified planning brief or the richer attempt-level artifacts targeted in this roadmap.
- Current behavior is already locked by focused suites such as `tests/planning-pipeline.test.mjs`, `tests/openclaw-runtime-adapter.test.mjs`, `tests/orchestrator-runtime.test.mjs`, `tests/orchestrator-goose-runtime.test.mjs`, `tests/file-backed-run-store.test.mjs`, and `tests/run-trace-analyzer.test.mjs`.
- Existing design docs already define part of the target state, especially [docs/plans/2026-03-17-planning-brief-coordination.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/plans/2026-03-17-planning-brief-coordination.md), [docs/plans/2026-03-17-planning-brief-coordination-design.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/plans/2026-03-17-planning-brief-coordination-design.md), and [docs/harness-engineering-v2.1-report.zh-CN.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/harness-engineering-v2.1-report.zh-CN.md).
- Prompts and adapters are coupled to this work, so planning prompt changes must land with planning contract changes, and worker/quality prompt changes must land with adapter/runtime changes.
- This roadmap is a mix of alignment and extension:
  - Phase 1 mostly aligns implementation to an already documented planning-coordination target.
  - Phases 2-4 extend runtime capability, but should do so without breaking ownership boundaries or orchestration invariants.

## Acceptance Criteria

- [ ] The plan keeps `main-orchestrator` as the only global controller.
- [ ] Every task remains implementation-focused and uses exact file paths.
- [ ] Phase ordering is explicit and later phases depend on earlier contract hardening where needed.
- [ ] Each task-sized slice is small enough to run as one Goose PR loop.
- [ ] Validation steps are concrete and phase-appropriate.
- [ ] The plan can be executed from this single document by Goose using `### Task N:` headings.

## Affected Modules

- Modify: `src/schemas/planning.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/planning/contracts.ts`
- Modify: `src/planning/planning-controller.ts`
- Modify: `src/planning/planning-pipeline.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Modify: `src/planning/debate-synthesizer.ts`
- Modify: `src/planning/mock-planners.ts`
- Modify: `src/workers/contracts.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/runtime-middleware.ts`
- Modify: `src/orchestrator/policy-engine.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/orchestrator/approval-manager.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `src/adapters/goose-worker-adapter.ts`
- Modify: `src/analysis/run-trace-analyzer.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/examples/planning-fixtures.ts`
- Modify: `src/examples/run-planning-demo.ts`
- Modify: `prompts/planning-agent.system.md`
- Modify: `prompts/planning-agent.debate.md`
- Modify: `prompts/architecture-planner.md`
- Modify: `prompts/engineering-planner.md`
- Modify: `prompts/integration-planner.md`
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`
- Modify: `prompts/test-agent.md`
- Modify: `prompts/review-agent.md`
- Modify: `prompts/review-agent-codex-exec.md`
- Modify: `prompts/review-agent-output-schema.json`
- Modify: `README.md`
- Modify: `docs/context/repo-context.md`
- Modify: `docs/goose/task-contract.md`
- Create: `src/orchestrator/task-execution-contract.ts`
- Create: `tests/fixtures/planning/debate-coordination-golden.json`
- Create: `docs/plans/2026-04-03-task-operations-design.md`

## Risks

- Risk: Phase 2 expands scope too aggressively by trying to land every V2.1 idea at once.
  Mitigation: split contract schema, pre-dispatch checks, artifact persistence, and prompt uptake into separate tasks.
- Risk: Phase 3 introduces multi-reviewer behavior before QA contracts are structured.
  Mitigation: require structured `qa_report` first, then gate internal triad review as the last task in the phase.
- Risk: Phase 4 turns into an open-ended platform rewrite.
  Mitigation: start with workflow-discipline/task-lifecycle scaffolding and an operator-read surface before any heavy registry/session machinery.
- Risk: Goose task loops become unstable if a single task mixes design, schema, adapters, prompts, and persistence.
  Mitigation: keep task boundaries seam-oriented and validation-focused.

## Validation Plan

- Phase 1 focuses on `npm run test:planning` plus planning goldens and demos.
- Phase 2 focuses on runtime schema, adapters, and artifact persistence tests, then `npm run test:runtime`.
- Phase 3 focuses on quality-gate contracts, prompt/output schema tests, and end-to-end runtime flows.
- Phase 4 focuses on task-lifecycle/operator-surface tests plus any affected CLI/reporting checks.
- Broad validation at milestone boundaries should include:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
node --test tests/orchestrator-goose-runtime.test.mjs tests/orchestrator-e2e.test.mjs
```

## Deliverables

- A single Goose-executable phased implementation plan
- Coordinator-first planning contracts and prompts
- Attempt-level contract and artifact-first runtime handoff surfaces
- Structured QA outputs for `test-agent` and `review-agent`
- Task-lifecycle and stage-discipline scaffolding delivered in bounded slices
- Updated docs, prompts, demos, and focused validation for each slice

## Preconditions And Shared Contracts

- Run tasks in order; Phase 2 starts only after Phase 1 is merged.
- Phase 3 starts only after Phase 2 tasks that define QA artifacts are merged.
- Phase 4 starts only after Phase 3 proves stable structured QA/report surfaces.
- Goose should execute this file one `### Task N:` slice at a time through the existing PR-sized loop.
- If any task uncovers a design contradiction, pause after that PR and refresh this plan before continuing.

## Task Breakdown

## Phase 1: Planning-Agent Coordination

**Objective:** Implement the coordinator-led planning design captured in [docs/plans/2026-03-17-planning-brief-coordination.md](/Users/openclaw/.codex/worktrees/788b/multi-agent-coding-assistant/docs/plans/2026-03-17-planning-brief-coordination.md#L5) without changing the rule that planning outputs implementation-only tasks.

### Task 1: Add clarified-brief planning schemas and trace metadata

**Files:**
- Modify: `src/schemas/planning.ts`
- Modify: `src/planning/contracts.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Test: `tests/planning-pipeline.test.mjs`

**Phase notes:**
- This task establishes the data model only.
- Do not change debate execution order yet.

**Step 1: Write the failing tests**

Add focused assertions that `planning_trace` can carry:
- `clarified_brief`
- clarification round counts
- cross-review round counts

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test:planning
```

Expected: FAIL because current planning schemas and trace metadata do not include coordinator artifacts.

**Step 3: Implement the minimal schema changes**

Add:
- `ClarifiedPlanningBrief`
- `PlanningClarificationRequest`
- bounded cross-review metadata

Wire those through normalization inputs and final trace output.

**Step 4: Re-run the focused tests**

Run:

```bash
npm run test:planning
```

Expected: PASS for the new schema and trace assertions.

### Task 2: Make `planning-agent` the real debate coordinator

**Files:**
- Modify: `src/planning/planning-pipeline.ts`
- Modify: `src/planning/planning-controller.ts`
- Modify: `src/planning/planning-normalizer.ts`
- Modify: `src/examples/planning-fixtures.ts`
- Test: `tests/planning-pipeline.test.mjs`

**Phase notes:**
- This task should align implementation with the design record rather than invent a new planner topology.
- Preserve the current analyzer roles.

**Step 1: Write the failing tests**

Add assertions that debate planning:
- records `planning-agent` as the first route
- builds a clarified brief before analyzer fan-out
- keeps analyzer routes in the final trace

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test:planning
```

Expected: FAIL because debate planning still records only analyzer routes.

**Step 3: Implement the minimal coordination flow**

Update debate mode so it:
- resolves a coordinator route for `planning-agent`
- builds the clarified brief
- passes the same brief to all analyzers
- normalizes the coordinator route and analyzer routes together

**Step 4: Re-run the focused tests**

Run:

```bash
npm run test:planning
```

Expected: PASS with coordinator route ordering and clarified brief propagation.

### Task 3: Add bounded clarification and planner cross-review

**Files:**
- Modify: `src/planning/contracts.ts`
- Modify: `src/planning/mock-planners.ts`
- Modify: `src/planning/debate-synthesizer.ts`
- Test: `tests/planning-pipeline.test.mjs`
- Create: `tests/fixtures/planning/debate-coordination-golden.json`

**Phase notes:**
- Keep the protocol bounded: zero or one clarification round, zero or one cross-review round.
- No free-form multi-agent conversation mesh.

**Step 1: Write the failing tests**

Add coverage that analyzers can emit:
- clarification requests
- one bounded cross-review round

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test:planning
```

Expected: FAIL because analyzer outputs do not include clarification or cross-review metadata.

**Step 3: Implement the bounded protocol**

Extend analyzer outputs and synthesis logic with structured clarification and cross-review fields, then capture the interaction in a golden fixture.

**Step 4: Re-run the focused tests**

Run:

```bash
npm run test:planning
```

Expected: PASS with the new golden interaction trace.

### Task 4: Refresh prompts, demos, and docs for the coordination model

**Files:**
- Modify: `prompts/planning-agent.system.md`
- Modify: `prompts/planning-agent.debate.md`
- Modify: `prompts/architecture-planner.md`
- Modify: `prompts/engineering-planner.md`
- Modify: `prompts/integration-planner.md`
- Modify: `src/examples/run-planning-demo.ts`
- Modify: `README.md`
- Modify: `docs/context/repo-context.md`
- Test: `tests/orchestrator-e2e.test.mjs`

**Phase notes:**
- Make the prompt contract and code contract match.
- Keep quality-gate ownership unchanged.

**Step 1: Write the failing golden/demo expectations**

Add or update assertions that the planning demo and planning fixture output include:
- coordinator route
- clarified brief metadata
- bounded clarification/cross-review counts

**Step 2: Run focused verification**

Run:

```bash
npm run build
npm run test:planning
node --test tests/orchestrator-e2e.test.mjs
```

Expected: FAIL until prompts/examples/docs are aligned.

**Step 3: Implement prompt/example/doc alignment**

Refresh the planning prompts and docs so contributors and agents see the new coordinator protocol as the baseline.

**Step 4: Re-run verification**

Run:

```bash
npm run build
npm run test:planning
node --test tests/orchestrator-e2e.test.mjs
```

Expected: PASS.

---

## Phase 2: Contract-Aware Artifact-First Handoff

**Objective:** Build attempt-level handoff artifacts on top of the existing worker/request/evidence fields so dispatch, testing, review, and retry become more explicit and analyzable.

### Task 5: Add `TaskExecutionContract` and artifact schemas

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `src/index.ts`
- Test: `tests/openclaw-runtime-adapter.test.mjs`
- Test: `tests/orchestrator-runtime.test.mjs`

**Phase notes:**
- Add new artifacts without breaking current status semantics.
- Start with schema and typed envelopes only.

**Step 1: Write the failing tests**

Add assertions for:
- `TaskExecutionContract`
- `ImplementationAttemptReport`
- `QaReport`
- `RetryDiagnosisReport`

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected: FAIL because these artifacts do not exist yet.

**Step 3: Implement the minimal schema layer**

Define typed contract/report artifacts and thread them through runtime task records and adapter envelopes without changing orchestration ownership.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected: PASS.

### Task 6: Build pre-dispatch contract assembly and validation

**Files:**
- Create: `src/orchestrator/task-execution-contract.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/runtime-middleware.ts`
- Modify: `src/orchestrator/policy-engine.ts`
- Test: `tests/orchestrator-middleware.test.mjs`
- Test: `tests/orchestrator-policy-engine.test.mjs`

**Phase notes:**
- Keep checks bounded and orchestration-owned.
- Do not add a second controller.

**Step 1: Write the failing tests**

Add assertions that high-risk or incomplete tasks:
- get a pre-dispatch contract built
- can be rejected or paused when required contract fields are missing

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-policy-engine.test.mjs
```

Expected: FAIL because no pre-dispatch contract assembly/check exists.

**Step 3: Implement the minimal contract builder**

Build the attempt-level contract from:
- planning task fields
- runtime context
- retry history
- policy state

Add one bounded pre-dispatch validation seam for high-risk tasks.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/orchestrator-middleware.test.mjs tests/orchestrator-policy-engine.test.mjs
```

Expected: PASS.

### Task 7: Thread artifact-first handoff through Goose/OpenClaw workers

**Files:**
- Modify: `src/adapters/goose-recipe-builder.ts`
- Modify: `src/adapters/goose-worker-adapter.ts`
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Modify: `prompts/frontend-agent.md`
- Modify: `prompts/backend-agent.md`
- Test: `tests/goose-recipe-builder.test.mjs`
- Test: `tests/goose-worker-adapter.test.mjs`
- Test: `tests/orchestrator-goose-runtime.test.mjs`

**Phase notes:**
- Keep the worker seam typed and portable.
- Do not change the fact that Goose is the implementation executor only.

**Step 1: Write the failing tests**

Add coverage that worker payloads carry:
- the task execution contract
- structured implementation attempt reports
- structured retry diagnosis reports

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/goose-recipe-builder.test.mjs tests/goose-worker-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: FAIL until adapter payloads and prompts are updated.

**Step 3: Implement payload threading and prompt uptake**

Thread the new artifacts through Goose/OpenClaw request payloads and teach implementation prompts to use them explicitly.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/goose-recipe-builder.test.mjs tests/goose-worker-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: PASS.

### Task 8: Persist contract/report artifacts and expose them in summaries

**Files:**
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/analysis/run-trace-analyzer.ts`
- Test: `tests/file-backed-run-store.test.mjs`
- Test: `tests/runtime-event-schema.test.mjs`
- Test: `tests/run-trace-analyzer.test.mjs`

**Phase notes:**
- Treat these artifacts as first-class run history, not transient prompt baggage.

**Step 1: Write the failing tests**

Add assertions that persisted runs and analysis outputs include the new contract/report artifacts or their stable summaries.

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/file-backed-run-store.test.mjs tests/runtime-event-schema.test.mjs tests/run-trace-analyzer.test.mjs
```

Expected: FAIL until persistence and reporting surfaces are updated.

**Step 3: Implement persistence/reporting support**

Persist the new artifacts or stable summaries in runtime snapshots and expose them through reporting/analyzer outputs.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/file-backed-run-store.test.mjs tests/runtime-event-schema.test.mjs tests/run-trace-analyzer.test.mjs
```

Expected: PASS.

---

## Phase 3: Quality-Agent Deepening

**Objective:** Turn `test-agent` and `review-agent` into structured evaluators that emit reusable QA artifacts, then optionally add bounded multi-reviewer behavior inside the logical `review-agent`.

### Task 9: Add structured QA report contracts for quality gates

**Files:**
- Modify: `src/workers/contracts.ts`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/adapters/openclaw-runtime-adapter.ts`
- Test: `tests/openclaw-runtime-adapter.test.mjs`
- Test: `tests/orchestrator-runtime.test.mjs`

**Phase notes:**
- Keep top-level quality-gate statuses as `completed`, `needs_fix`, or `failed`.
- Do not make quality roles into task owners.

**Step 1: Write the failing tests**

Add assertions that quality gates can emit a structured `QaReport` with:
- verdict
- findings
- evidence
- verification scope
- residual risks

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected: FAIL because quality outputs do not yet use structured QA reports.

**Step 3: Implement the minimal QA report layer**

Add typed QA report support to quality gate requests/results and runtime summaries.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected: PASS.

### Task 10: Deepen `test-agent` into a structured verification role

**Files:**
- Modify: `prompts/test-agent.md`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `docs/goose/task-contract.md`
- Test: `tests/orchestrator-precompletion-checklist.test.mjs`
- Test: `tests/orchestrator-goose-runtime.test.mjs`

**Phase notes:**
- Preserve the rule that `test-agent` uses the smallest reliable verification scope.
- Make the output richer, not broader in ownership.

**Step 1: Write the failing tests**

Add assertions that `test-agent` can report:
- verification scope used
- explicit pass/fail evidence
- missing evidence vs true failures
- residual verification gaps

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: FAIL until `test-agent` expectations and result shaping are upgraded.

**Step 3: Implement prompt and runner updates**

Deepen the prompt and runner normalization so `test-agent` produces structured verification output tied to QA reports.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/orchestrator-precompletion-checklist.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: PASS.

### Task 11: Deepen `review-agent` into a structured review role

**Files:**
- Modify: `prompts/review-agent.md`
- Modify: `prompts/review-agent-codex-exec.md`
- Modify: `prompts/review-agent-output-schema.json`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Test: `tests/local-codex-review.test.mjs`
- Test: `tests/local-codex-review-adapter.test.mjs`

**Phase notes:**
- Build on the local Codex review path already present in the repo.
- Keep final runtime ownership with the logical `review-agent`.

**Step 1: Write the failing tests**

Add assertions that review output includes:
- structured findings
- severity/priority
- decision rationale
- residual risk summary

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/local-codex-review.test.mjs tests/local-codex-review-adapter.test.mjs
```

Expected: FAIL until the review schema and normalization are upgraded.

**Step 3: Implement prompt/schema/runner updates**

Strengthen the review prompt and output schema so the runtime can consume structured review findings and QA reports rather than only strings.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/local-codex-review.test.mjs tests/local-codex-review-adapter.test.mjs
```

Expected: PASS.

### Task 12: Add bounded internal triad review inside the logical `review-agent`

**Files:**
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/workers/contracts.ts`
- Modify: `prompts/review-agent.md`
- Test: `tests/orchestrator-runtime.test.mjs`
- Test: `tests/orchestrator-e2e.test.mjs`

**Phase notes:**
- This task depends on Tasks 9-11.
- Keep triad review internal to the logical `review-agent` gate.

**Step 1: Write the failing tests**

Add assertions that:
- multiple internal reviewer perspectives can be represented
- one bounded cross-review round is possible
- the top-level gate still returns one logical review decision

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-e2e.test.mjs
```

Expected: FAIL until internal triad review wiring exists.

**Step 3: Implement bounded internal triad review**

Add the minimum internal triad-review protocol needed to preserve richer review perspectives without changing orchestrator ownership boundaries.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/orchestrator-runtime.test.mjs tests/orchestrator-e2e.test.mjs
```

Expected: PASS.

---

## Phase 4: Task Operations and Stage Discipline

**Objective:** Introduce task-centric lifecycle and operator scaffolding in small, reviewable steps rather than jumping straight to a large persistent task platform.

### Task 13: Add a task-operations design baseline and task lifecycle schema

**Files:**
- Create: `docs/plans/2026-04-03-task-operations-design.md`
- Modify: `src/schemas/runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/runtime-event-schema.test.mjs`

**Phase notes:**
- Start with schema and documentation before runtime control surfaces.
- Explicitly define lifecycle states and stage checkpoints.

**Step 1: Write the failing tests**

Add assertions for new task-lifecycle metadata such as:
- stage
- stage status
- checkpoint markers
- operator-facing task summary fields

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/runtime-event-schema.test.mjs
```

Expected: FAIL until lifecycle schema support exists.

**Step 3: Implement the minimal lifecycle layer**

Add task-lifecycle/schema scaffolding and the supporting design doc without yet adding a full registry or session model.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/runtime-event-schema.test.mjs
```

Expected: PASS.

### Task 14: Add stage-discipline checkpoints to the orchestration loop

**Files:**
- Modify: `src/orchestrator/main-orchestrator.ts`
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Test: `tests/orchestrator-persistence.test.mjs`
- Test: `tests/orchestrator-approval-controls.test.mjs`

**Phase notes:**
- Focus on phase/stage checkpoint metadata and pause/resume semantics.
- Do not add a new controller.

**Step 1: Write the failing tests**

Add coverage that stage transitions and checkpoint records survive:
- pause/resume
- waiting-for-approval
- implementation-to-quality transitions

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/orchestrator-persistence.test.mjs tests/orchestrator-approval-controls.test.mjs
```

Expected: FAIL until stage metadata is persisted and reported.

**Step 3: Implement stage checkpoint support**

Add stage-level checkpoint/state reporting to the existing runtime and persistence surfaces.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/orchestrator-persistence.test.mjs tests/orchestrator-approval-controls.test.mjs
```

Expected: PASS.

### Task 15: Add a task-centric operator summary surface

**Files:**
- Modify: `src/orchestrator/reporting-manager.ts`
- Modify: `src/analysis/run-trace-analyzer.ts`
- Modify: `src/cli/main.ts`
- Test: `tests/run-trace-analyzer.test.mjs`
- Test: `tests/cli-smoke.test.mjs`

**Phase notes:**
- This is an operator-read surface first, not a full interactive task console.
- Prefer summaries over mutations in the first slice.

**Step 1: Write the failing tests**

Add assertions that task-centric summaries expose:
- lifecycle stage
- current owner
- latest contract/report artifacts
- stage checkpoint history

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/run-trace-analyzer.test.mjs tests/cli-smoke.test.mjs
```

Expected: FAIL until task-centric reporting and CLI output exist.

**Step 3: Implement the minimal operator surface**

Extend analyzer/reporting/CLI output with task-centric views while keeping the CLI scope intentionally read-heavy.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/run-trace-analyzer.test.mjs tests/cli-smoke.test.mjs
```

Expected: PASS.

### Task 16: Add a narrow task session / operator control scaffold

**Files:**
- Modify: `src/schemas/runtime.ts`
- Modify: `src/orchestrator/approval-manager.ts`
- Modify: `src/storage/run-store.ts`
- Modify: `src/storage/file-backed-run-store.ts`
- Test: `tests/orchestrator-persistence.test.mjs`
- Test: `tests/orchestrator-approval-controls.test.mjs`

**Phase notes:**
- Keep this intentionally narrow: session/control scaffolding, not a full task registry platform.
- If earlier Phase 4 tasks reveal insufficient value, stop before this task.

**Step 1: Write the failing tests**

Add coverage for a minimal task-session/control scaffold such as:
- task-level pause marker
- operator-note or escalation marker
- task-level manual-review handoff marker

**Step 2: Run focused verification**

Run:

```bash
npm run build
node --test tests/orchestrator-persistence.test.mjs tests/orchestrator-approval-controls.test.mjs
```

Expected: FAIL until the narrow task-session/control scaffold exists.

**Step 3: Implement the minimum viable scaffold**

Add only the smallest task-session/operator-control metadata needed to prove the value of task operations without committing to a large persistent registry design.

**Step 4: Re-run verification**

Run:

```bash
npm run build
node --test tests/orchestrator-persistence.test.mjs tests/orchestrator-approval-controls.test.mjs
```

Expected: PASS.

---

## Phase Ordering and Execution Notes

- Run tasks in order. Phase 2 starts only after Phase 1 is merged.
- Phase 3 starts only after Phase 2 tasks that define QA artifacts are merged.
- Phase 4 starts only after Phase 3 proves stable structured QA/report surfaces.
- Goose should execute this file one `### Task N:` slice at a time through the existing PR-sized loop.
- If any task uncovers a design contradiction, pause after that PR and refresh this plan before continuing.

## Deliverables

- Planning coordination artifacts and prompts
- Attempt-level contract and artifact-first handoff surfaces
- Structured QA reports for `test-agent` and `review-agent`
- Task-lifecycle and stage-discipline scaffolding
- Updated docs and focused validation for each slice
