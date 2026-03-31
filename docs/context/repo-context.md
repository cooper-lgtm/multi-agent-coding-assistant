# Repository Context Artifact

This file is a concise operational snapshot for contributors and agents.
If this artifact conflicts with current code or root docs, prefer `README.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and `AGENTS.md`, then refresh this file.

## Canonical Read Order
1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `AGENTS.md`
5. `docs/roadmap/2026-03-22-runtime-success-roadmap.md`
6. `docs/plans/2026-03-22-runtime-success-harness-design.md`
7. `docs/plans/2026-03-22-pr10-rich-context-injection.md`
8. `docs/plans/2026-03-23-runtime-success-breakdown.md`
9. `docs/templates/task-template.md`
10. `docs/reviews/recurring-issues.md`
11. relevant `src/` modules and `tests/`

## Current Baseline (2026-03-30)
- TypeScript orchestration kernel is active for planning, DAG execution, implementation dispatch, quality gates, retry/escalation, reporting, and file-backed persistence/resume.
- Planning/runtime tasks now preserve compact `execution_guidance` fields through normalization, validation, and DAG/runtime task creation.
- Runtime middleware, pre-completion checklist continuation, retry diagnosis, loop-detection guidance, structured runtime events, and repo-local trace analysis are all present in the current baseline.
- Planning/runtime invariants remain enforced in root docs and tests:
  - `main-orchestrator` is sole global controller
  - planning outputs implementation tasks only
  - implementation owners are `frontend-agent` / `backend-agent`
  - `test-agent` / `review-agent` are post-implementation quality gates
  - `needs_fix`, `blocked`, `failed` remain distinct
  - model routing should preserve logical labels plus exact-model metadata
- The runtime-first harness program described by PR10 through PR13 has landed in the repository baseline:
  - rich context injection
  - self-verification guardrails
  - retry diagnosis and loop detection
  - structured trace analysis and repo-local feedback workflow
- Goose integration baseline advanced through the prior active plan:
  - structured goose worker-result contracts are present
  - goose recipe assets and role-to-recipe mapping are present
  - goose worker adapter + goose process runner are present
  - orchestrator implementation dispatch can route through goose-backed dispatcher while keeping external quality gates
  - approval controls can pause after planning and require explicit approval before execution resumes
  - policy controls now centralize dispatch limits, retry budgets, fallback chains, and high-risk manual-review guardrails above the goose worker seam
  - eval suite and golden scenarios are present
  - CLI entry surface now exposes `plan`, `run`, and `resume` commands with stable runtime/planning flags
  - goose delivery workflow documentation exists under `docs/goose/pr-workflow.md`
- Runtime evidence now carries implementation execution context (commands, tests, risk notes, suggested status, delivery metadata, retry handoff) through dispatch, reporting, and persisted runtime state.
- Persisted runs now expose a deterministic analyzer entry point through `src/analysis/run-trace-analyzer.ts` and `scripts/analyze-run-traces.mjs`.

## Active Plan and Task Slices
Primary execution plan: `docs/plans/2026-03-23-runtime-success-breakdown.md`

Roadmap reference: `docs/roadmap/2026-03-22-runtime-success-roadmap.md`

Runtime-success slices (status inferred from repository state):
1. PR10a execution-guidance contracts and DAG propagation — **complete**
2. PR10b runtime context builder and local discovery — **complete**
3. PR10c worker payload threading and prompt uptake — **complete**
4. PR11a runtime middleware seam — **complete**
5. PR11b pre-completion checklist and continuation — **complete**
6. PR12a retry diagnosis contracts — **complete**
7. PR12b loop detection and retry guidance propagation — **complete**
8. PR13a structured runtime-event schema — **complete**
9. PR13b trace analyzer and script — **complete**

## Module Map
- `src/schemas/`: shared planning/runtime/model contracts
- `src/planning/`: mode resolution, direct/debate flows, normalization/synthesis
- `src/analysis/`: run-trace analysis helpers and summary rendering
- `src/orchestrator/`: DAG builder, runtime loop, dispatcher, quality gates, retry, reporting
- `src/adapters/`: OpenClaw request/result shaping, model routing/resolution, goose recipe packaging, goose process/worker adapter
- `src/workers/`: worker contracts and retry-handoff context
- `src/storage/`: run store contracts and file-backed persistence
- `src/examples/`: demos/fixtures (planning, runtime, adapter, persistence, goose worker)
- `src/cli/`: CLI command surface for plan/run/resume entry points
- `tests/`: adapter/planning/runtime/persistence/e2e/cli verification

## Validation Commands
Standard:
```bash
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
```

Current baseline regression gate:
```bash
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
node --test tests/runtime-event-schema.test.mjs
node --test tests/run-trace-analyzer.test.mjs
node --test tests/analyze-run-traces.test.mjs
node --test tests/goose-worker-contract.test.mjs
node --test tests/goose-recipe-builder.test.mjs
node --test tests/goose-worker-adapter.test.mjs
node --test tests/orchestrator-goose-runtime.test.mjs
node --test tests/orchestrator-approval-controls.test.mjs
node --test tests/orchestrator-policy-engine.test.mjs
node --test tests/orchestrator-e2e.test.mjs
node --test tests/cli-smoke.test.mjs
```

## PR / Workflow Rules (from active plan + AGENTS.md)
- one execution slice per branch
- one slice-sized PR at a time
- Codex review is workflow-triggered automation for each PR
- merge only after required local validation passes
- preserve orchestrator ownership boundaries (goose at implementation seam only; quality gates remain external evaluators)

## Artifact Metadata
- artifact_type: `repo-context`
- version: `1.9.0`
- status: `refreshed`
- refreshed_on: `2026-03-30`
