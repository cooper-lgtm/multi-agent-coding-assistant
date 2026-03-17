# Repository Context Artifact

This file is a concise operational snapshot for contributors and agents.
If this artifact conflicts with current code or root docs, prefer `README.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and `AGENTS.md`, then refresh this file.

## Canonical Read Order
1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `AGENTS.md`
5. `docs/plans/2026-03-16-goose-integration-post-pr5.md`
6. `docs/templates/task-template.md`
7. `docs/reviews/recurring-issues.md`
8. relevant `src/` modules and `tests/`

## Current Baseline (2026-03-17)
- TypeScript orchestration kernel is active for planning, DAG execution, implementation dispatch, quality gates, retry/escalation, reporting, and file-backed persistence/resume.
- Planning/runtime invariants remain enforced in root docs and tests:
  - `main-orchestrator` is sole global controller
  - planning outputs implementation tasks only
  - implementation owners are `frontend-agent` / `backend-agent`
  - `test-agent` / `review-agent` are post-implementation quality gates
  - `needs_fix`, `blocked`, `failed` remain distinct
  - model routing should preserve logical labels plus exact-model metadata
- Goose integration baseline has advanced through Task 8 of the active plan:
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
Primary plan: `docs/plans/2026-03-16-goose-integration-post-pr5.md`

Planned slices (status inferred from repository state):
1. Structured goose worker-result contracts — **completed**
2. Goose recipe assets + task-to-recipe mapping — **completed**
3. Goose worker adapter — **completed**
4. Route implementation dispatch through goose (quality gates remain external) — **completed**
5. PR6 approval/orchestration controls — **completed**
6. PR7 budget/policy/safety controls — **completed**
7. PR8 eval suite + golden scenarios — **completed**
8. PR9 CLI entry points + goose delivery workflow — **completed**

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

Full required gate from active plan:
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
- version: `1.6.0`
- status: `refreshed`
- refreshed_on: `2026-03-17`
