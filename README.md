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

## Current Structure

- `docs/`: architecture notes and implementation-facing docs
- `prompts/`: English prompt assets for planning and worker roles
- `src/schemas/`: shared runtime and planning types
- `src/adapters/`: model routing and runtime integration adapters
- `src/planning/`: planning controller contracts
- `src/orchestrator/`: DAG builder, orchestrator loop, reporting
- `src/storage/`: runtime state persistence contracts
- `src/workers/`: worker invocation contracts

## Design Rules Captured

- Planning only produces implementation tasks.
- `test-agent` and `review-agent` are quality gates, not planning owners.
- `assigned_agent` must be unique per task.
- Cross-frontend/backend work must be split.
- The main orchestrator remains the only global controller.
- Model selection must support fallback chains.

## Next Implementation Milestones

1. JSON schema validation for planning results
2. Concrete OpenClaw session adapter
3. Worker dispatch and result ingestion
4. Quality gate execution loop
5. File-backed runtime store
6. CLI / chat entry integration
