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
7. `docs/templates/task-template.md`
8. `docs/reviews/recurring-issues.md`
9. relevant `src/` modules and `tests/`

## Current Baseline (2026-03-22)
- TypeScript orchestration kernel is active for planning, DAG execution, implementation dispatch, quality gates, retry/escalation, reporting, and file-backed persistence/resume.
- Planning/runtime invariants remain enforced in root docs and tests:
  - `main-orchestrator` is sole global controller
  - planning outputs implementation tasks only
  - implementation owners are `frontend-agent` / `backend-agent`
  - `test-agent` / `review-agent` are post-implementation quality gates
  - `needs_fix`, `blocked`, `failed` remain distinct
  - model routing should preserve logical labels plus exact-model metadata
- The next planned delivery phase is a runtime-first harness program aimed at improving real task success rate:
  - PR10 rich context injection
  - PR11 self-verification guardrails
  - PR12 retry diagnosis and loop detection
  - PR13 structured trace analysis and feedback loop
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

## Active Plan and Task Slices
Primary plan: `docs/roadmap/2026-03-22-runtime-success-roadmap.md`

Planned slices (status inferred from repository state):
1. PR10 rich context injection — **planned**
2. PR11 self-verification guardrails — **planned**
3. PR12 retry diagnosis and loop detection — **planned**
4. PR13 trace analysis feedback loop — **planned**

## Module Map
- `src/schemas/`: shared planning/runtime/model contracts
- `src/planning/`: mode resolution, direct/debate flows, normalization/synthesis
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
- one roadmap slice per branch
- one slice-sized PR at a time
- Codex review is workflow-triggered automation for each PR
- merge only after required local validation passes
- preserve orchestrator ownership boundaries (goose at implementation seam only; quality gates remain external evaluators)

## Artifact Metadata
- artifact_type: `repo-context`
- version: `1.7.0`
- status: `refreshed`
- refreshed_on: `2026-03-22`
