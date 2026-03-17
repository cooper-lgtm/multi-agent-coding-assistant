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
- Task 1 and Task 2 from the goose integration plan are now implemented.
- Current runtime is still mock implementation dispatch (goose adapter/runtime wiring remains future task scope).

## Active Plan and Task Slices
Primary plan: `docs/plans/2026-03-16-goose-integration-post-pr5.md`

Planned slices (status inferred from repository state):
1. Structured goose worker-result contracts — **completed**
2. Goose recipe assets + task-to-recipe mapping — **completed**
3. Goose worker adapter — **pending**
4. Route implementation dispatch through goose (quality gates remain external) — **pending**
5. PR6 approval/orchestration controls — **pending**
6. PR7 budget/policy/safety controls — **pending**
7. PR8 eval suite + golden scenarios — **pending**
8. PR9 CLI entry points + goose delivery workflow — **pending**

Evidence now present for Task 2:
- `src/adapters/goose-recipe-builder.ts`
- `tests/goose-recipe-builder.test.mjs`
- `.goose/recipes/frontend-implementation.yaml`
- `.goose/recipes/backend-implementation.yaml`
- `.goose/recipes/shared/worker-output-schema.json`
- `docs/goose/task-contract.md`

## Module Map
- `src/schemas/`: shared planning/runtime/model contracts
- `src/planning/`: mode resolution, direct/debate flows, normalization/synthesis
- `src/orchestrator/`: DAG builder, runtime loop, dispatcher, quality gates, retry, reporting
- `src/adapters/`: OpenClaw request/result shaping, model routing/resolution, goose recipe packaging
- `src/workers/`: worker contracts and retry-handoff context
- `src/storage/`: run store contracts and file-backed persistence
- `src/examples/`: demos/fixtures (planning, runtime, adapter, persistence)
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

Doc-only minimum:
```bash
git diff --check
```

## PR / Workflow Rules (from active plan + AGENTS.md)
- one roadmap slice per branch
- one slice-sized PR at a time
- include `@codex review` comment on each PR
- merge only after required local validation passes
- preserve orchestrator ownership boundaries (goose at implementation seam only)

## Drift Notes
- Context artifact now aligned with merged Task 2 repository state.

## Known Operational Gaps
- Goose-backed implementation runtime path not wired yet.
- Goose worker adapter process execution path not present yet.
- Approval/policy/eval/CLI milestones from plan remain future work.

## Artifact Metadata
- artifact_type: `repo-context`
- version: `1.2.0`
- status: `refreshed`
- refreshed_on: `2026-03-17`
