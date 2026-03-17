# Repository Context Artifact

This file is a refreshed working summary for agents operating in this repository.
It is a convenience layer, not the ultimate source of truth.

Canonical source order:
1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `AGENTS.md`
5. relevant `docs/plans/`
6. relevant source files and tests

If this artifact drifts from the repository, prefer the canonical files and refresh this document.

## Purpose

This repository implements a TypeScript orchestration kernel for OpenClaw-based multi-agent coding workflows.
The current system goal is to keep planning, DAG execution, quality gates, retry, persistence, and reporting explicit and recoverable.

The next architecture step is to replace the mock implementation worker bridge with a goose-backed execution runtime while keeping `test-agent` and `review-agent` under orchestrator control.

## Current Priorities

Priority order:
1. correctness
2. recoverability
3. traceability
4. contract clarity
5. breadth

Do not trade runtime correctness for convenience or speculative autonomy.

## Stable Architecture Summary

Core flow:
1. classify request and resolve planning mode
2. run planning pipeline
3. validate planning result
4. build execution DAG
5. dispatch implementation work to `frontend-agent` or `backend-agent`
6. run `test-agent` and `review-agent` as quality gates
7. apply retry and escalation
8. persist runtime state and report final summary

Key invariants:
- `main-orchestrator` is the only global controller
- planning outputs implementation tasks only
- `assigned_agent` may only be `frontend-agent` or `backend-agent`
- `test-agent` and `review-agent` are evaluators, not task owners
- `needs_fix`, `blocked`, and `failed` are distinct recovery states
- logical model labels and exact model metadata must stay aligned

## Module Map

| Path | Responsibility |
| --- | --- |
| `src/schemas/` | planning, runtime, and model contracts |
| `src/planning/` | planning mode resolution, direct/debate flow, synthesis, normalization |
| `src/orchestrator/` | DAG build, runtime loop, dispatch, quality gates, retry, reporting |
| `src/adapters/` | OpenClaw envelopes, model routing, exact-model resolution |
| `src/workers/` | worker execution contracts and retry handoff |
| `src/storage/` | run persistence and resume support |
| `src/examples/` | runnable demos and typed fixtures |
| `tests/` | adapter, planning, runtime, and persistence coverage |
| `prompts/` | prompt assets for planning, implementation, and quality roles |

## Active Delivery Plan

Primary plan:
- `docs/plans/2026-03-16-goose-integration-post-pr5.md`

Current planned task slices:
1. Add structured goose worker-result contracts
2. Add goose recipe assets and task-to-recipe mapping
3. Implement the goose worker adapter
4. Route implementation work through goose while keeping quality gates external
5. Implement PR6 human approval and orchestration controls
6. Implement PR7 budget, policy, and safety controls
7. Implement PR8 evaluation suite and golden scenarios
8. Implement PR9 CLI entry points and goose delivery workflow

Execution rule:
- one task-sized PR at a time
- one branch per PR
- always comment `@codex review`
- do not wait for review completion if required local verification passed

## Validation Surface

Standard verification commands:

```bash
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
```

Task-specific tests should be added and run alongside these when relevant.

## Goose Operating Rules

When goose works in this repository:
- read root docs before making architecture decisions
- use `docs/templates/task-template.md` for non-trivial tasks
- keep work scoped to one major task from the active plan
- preserve orchestrator ownership boundaries
- do not silently collapse statuses or retry semantics
- update docs when contracts or workflow assumptions change

## Context Refresh Inputs

Refresh this artifact from:
- `README.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `docs/plans/2026-03-16-goose-integration-post-pr5.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`
- relevant `src/` modules and `tests/` for the currently active task

## Refresh Policy

Refresh this artifact:
- before starting a new task-sized PR
- after merging a task-sized PR
- after any architecture-sensitive change that shifts role boundaries, contracts, routing, or validation

## Current Known Gaps

- goose execution runtime is not yet wired into the implementation dispatcher
- repo context automation is being bootstrapped through `.goose/recipes/`
- quality gates remain external and should stay external during goose integration

## Artifact Metadata

- artifact_type: `repo-context`
- intended_consumers: humans, goose recipes, orchestration helpers
- update_mode: refreshed, not hand-waved
- current_status: bootstrap
