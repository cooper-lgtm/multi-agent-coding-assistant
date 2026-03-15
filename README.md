# Multi-Agent Coding Assistant

A TypeScript implementation of an OpenClaw-native orchestrator system for:
- planning user requests into structured implementation tasks,
- converting planning output into an execution DAG,
- dispatching ready tasks to implementation workers,
- running post-implementation quality gates,
- handling retry, escalation, and reporting.

## MVP Scope

This repository focuses on the runtime kernel, not on long-lived manually registered agents.

Core flow:
1. Accept user request
2. Decide whether planning is needed
3. Run planning in `direct` or `debate`
4. Validate `planning result`
5. Convert to execution DAG
6. Dispatch ready implementation tasks
7. Run `test-agent` and `review-agent` as quality gates
8. Re-route `needs_fix`, escalate failures, and summarize results

This MVP now includes a coherent runtime loop with mockable adapters for implementation dispatch, quality gates, retry/escalation, persistence, and reporting.

## Current Structure

- `docs/`: architecture notes and implementation-facing docs
- `prompts/`: English prompt assets for planning and worker roles
- `src/schemas/`: shared runtime and planning types
- `src/adapters/`: model routing and runtime integration adapters
- `src/planning/`: planning controller contracts
- `src/orchestrator/`: DAG builder, main orchestrator, implementation dispatch, quality gates, retry/escalation, reporting
- `src/examples/`: typed planning fixtures and runnable orchestration demo
- `src/storage/`: runtime state persistence contracts
- `src/workers/`: worker invocation contracts

## Design Rules Captured

- Planning only produces implementation tasks.
- `test-agent` and `review-agent` are quality gates, not planning owners.
- `assigned_agent` can only be `frontend-agent` or `backend-agent`.
- Cross-frontend/backend work must be split.
- The main orchestrator remains the only global controller.
- Model selection must support explicit role-based fallback chains.

## Runtime Modules

- `implementation-dispatcher`: dispatches ready implementation tasks to `frontend-agent` or `backend-agent`
- `quality-gate-runner`: runs `test-agent` and `review-agent` after implementation completes
- `retry-escalation-manager`: applies the runtime retry policy and explicit per-role model fallback
- `reporting-manager`: records runtime events and builds concise run summaries

## Demo

Example artifacts included in this MVP:
- `src/examples/planning-fixtures.ts`: a 3-task planning result with dependencies
- `src/examples/run-orchestration-demo.ts`: a runnable mock orchestration flow
- `tests/orchestrator-runtime.test.mjs`: compiled-output runtime checks for success, retry escalation, and dependency blocking

Useful commands:

```bash
npm run typecheck
npm run test:runtime
npm run demo:orchestrator
```

## Next Implementation Milestones

1. JSON schema validation for planning results
2. Concrete OpenClaw session adapter for implementation and quality-gate roles
3. File-backed runtime store
4. Richer reporting output and checkpoint resume support
5. CLI / chat entry integration
