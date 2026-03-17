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
- Goose integration baseline has advanced through Task 5 of the active plan:
  - structured goose worker-result contracts are present
  - goose recipe assets and role-to-recipe mapping are present
  - goose worker adapter + goose process runner are present
  - orchestrator implementation dispatch can route through goose-backed dispatcher while keeping external quality gates
  - approval controls can pause after planning and require explicit approval before execution resumes
- Runtime evidence now carries implementation execution context (commands, tests, risk notes, suggested status, delivery metadata, retry handoff) through dispatch, reporting, and persisted runtime state.

## Active Plan and Task Slices
Primary plan: `docs/plans/2026-03-16-goose-integration-post-pr5.md`

Planned slices (status inferred from repository state):
1. Structured goose worker-result contracts — **completed**
2. Goose recipe assets + task-to-recipe mapping — **completed**
3. Goose worker adapter — **completed**
4. Route implementation dispatch through goose (quality gates remain external) — **completed**
5. PR6 approval/orchestration controls — **completed**
6. PR7 budget/policy/safety controls — **pending**
7. PR8 eval suite + golden scenarios — **pending**
8. PR9 CLI entry points + goose delivery workflow — **pending**

Task 3/5 evidence now present:
- `src/adapters/goose-worker-adapter.ts`
- `src/adapters/goose-process-runner.ts`
- `tests/goose-worker-adapter.test.mjs`
- `src/orchestrator/implementation-dispatcher.ts` (`GooseBackedImplementationDispatcher`)
- `tests/orchestrator-goose-runtime.test.mjs`
- `src/examples/run-goose-worker-demo.ts`
- `package.json` (`demo:goose`)
- `src/orchestrator/approval-manager.ts`
- `tests/orchestrator-approval-controls.test.mjs`

## Module Map
- `src/schemas/`: shared planning/runtime/model contracts
- `src/planning/`: mode resolution, direct/debate flows, normalization/synthesis
- `src/orchestrator/`: DAG builder, runtime loop, dispatcher, quality gates, retry, reporting
- `src/adapters/`: OpenClaw request/result shaping, model routing/resolution, goose recipe packaging, goose process/worker adapter
- `src/workers/`: worker contracts and retry-handoff context
- `src/storage/`: run store contracts and file-backed persistence
- `src/examples/`: demos/fixtures (planning, runtime, adapter, persistence, goose worker)
- `tests/`: adapter/planning/runtime/persistence verification

## Validation Commands
Standard:
```bash
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
```

Targeted goose/runtime checks:
```bash
npm run build && node --test tests/goose-worker-contract.test.mjs tests/goose-recipe-builder.test.mjs tests/goose-worker-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Targeted approval checks:
```bash
npm run build && node --test tests/orchestrator-approval-controls.test.mjs tests/orchestrator-persistence.test.mjs
```

Doc-only minimum:
```bash
git diff --check
```

## PR / Workflow Rules (from active plan + AGENTS.md)
- one roadmap slice per branch
- one slice-sized PR at a time
- Codex review is workflow-triggered automation for each PR
- merge only after required local validation passes
- preserve orchestrator ownership boundaries (goose at implementation seam only; quality gates remain external evaluators)

## Drift Notes
- Prior context artifact lagged behind current code by marking Tasks 3/5 as pending.
- Current code and tests show Task 3, Task 4, and Task 5 baseline present; artifact corrected accordingly.

## Known Operational Gaps
- PR7 budget/policy/safety guardrails remain future work.
- PR8 eval suite/golden scenarios remain future work.
- PR9 CLI entry and end-to-end goose delivery workflow remain future work.

## Artifact Metadata
- artifact_type: `repo-context`
- version: `1.4.0`
- status: `refreshed`
- refreshed_on: `2026-03-17`
