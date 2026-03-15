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
3. Resolve `auto` into `direct` or `debate`
4. Run the planning pipeline
5. Validate `planning result`
6. Convert to execution DAG
7. Dispatch ready implementation tasks
8. Run `test-agent` and `review-agent` as quality gates
9. Re-route `needs_fix`, escalate failures, and summarize results

This MVP now includes both:
- a coherent planning pipeline with typed contracts, normalization, synthesis, and mock planners/analyzers
- a coherent runtime loop with mockable adapters for implementation dispatch, quality gates, retry/escalation, persistence, and reporting
- an OpenClaw-facing adapter layer with typed planning/worker envelopes, alias-to-exact-model resolution, and mock runtime adapter stubs

## Current Structure

- `docs/`: architecture notes and implementation-facing docs
- `prompts/`: English prompt assets for planning and worker roles
- `src/schemas/`: shared runtime and planning types
- `src/adapters/`: model routing, exact-model resolution, and OpenClaw runtime integration adapters
- `src/planning/`: planning contracts, mode resolution, normalization, synthesis, mock planners/analyzers, controller facade, pipeline service
- `src/orchestrator/`: DAG builder, main orchestrator, implementation dispatch, quality gates, retry/escalation, reporting
- `src/examples/`: typed planning fixtures plus runnable planning, orchestration, and OpenClaw adapter demos
- `src/storage/`: runtime state persistence contracts
- `src/workers/`: worker invocation contracts

## Design Rules Captured

- Planning only produces implementation tasks.
- `test-agent` and `review-agent` are quality gates, not planning owners.
- `assigned_agent` can only be `frontend-agent` or `backend-agent`.
- Cross-frontend/backend work must be split.
- The main orchestrator remains the only global controller.
- Model selection must support explicit role-based fallback chains.
- No second long-lived OpenClaw agent is introduced for PR3.

## OpenClaw Adapter Layer

- The default main OpenClaw model remains `openai-codex/gpt-5.4`.
- Verified exact external model ids currently include:
  - `anthropic/claude-opus-4-6`
  - `google-gemini-cli/gemini-3.1-pro-preview`
- Logical compatibility labels are `codex`, `claude`, and `gemini`.
- Planning traces and runtime task records now carry exact model metadata where available while preserving logical labels in the existing `model` fields.

## Planning Modules

- `planning-mode-resolver`: resolves `auto` into `auto_resolved_direct` or `auto_resolved_debate`
- `planning-pipeline`: drives direct planning or debate planning from request to validated result
- `mock-planners`: deterministic direct planner and three debate analyzers for the MVP
- `debate-synthesizer`: merges architecture, engineering, and integration analyses into one planning draft
- `planning-normalizer`: normalizes drafts, attaches planning trace metadata, and prepares validated output

## Runtime Modules

- `implementation-dispatcher`: dispatches ready implementation tasks to `frontend-agent` or `backend-agent`
- `quality-gate-runner`: runs `test-agent` and `review-agent` after implementation completes
- `retry-escalation-manager`: applies the runtime retry policy and explicit per-role model fallback
- `reporting-manager`: records runtime events and builds concise run summaries

## Adapter Modules

- `openclaw-model-resolver`: maps logical labels and exact ids to provider-aware model metadata
- `openclaw-runtime-adapter`: standardizes planning and worker request/result/error envelopes for OpenClaw-facing execution
- `model-router`: keeps role-based fallback ordering while attaching exact-model metadata when available

## Demo

Example artifacts included in this MVP:
- `src/examples/planning-fixtures.ts`: typed direct, debate, and runtime planning fixtures
- `src/examples/openclaw-adapter-fixtures.ts`: typed OpenClaw request-envelope fixtures for planning and worker roles
- `src/examples/run-openclaw-adapter-demo.ts`: a runnable OpenClaw adapter-layer demo
- `src/examples/run-planning-demo.ts`: a runnable planning pipeline demo with direct and debate flows
- `src/examples/run-orchestration-demo.ts`: a runnable mock orchestration flow
- `tests/openclaw-model-resolution.test.mjs`: compiled-output checks for alias resolution and exact-model metadata
- `tests/openclaw-runtime-adapter.test.mjs`: compiled-output checks for planning/worker envelope shaping
- `tests/planning-mode-resolution.test.mjs`: compiled-output checks for `auto`/`direct`/`debate` resolution
- `tests/planning-pipeline.test.mjs`: compiled-output checks for direct planning, debate synthesis, and DAG conversion
- `tests/orchestrator-runtime.test.mjs`: compiled-output runtime checks for success, retry escalation, and dependency blocking

Useful commands:

```bash
npm run typecheck
npm run test:adapter
npm run test:planning
npm run test:runtime
npm run demo:adapter
npm run demo:planning
npm run demo:orchestrator
```

## Next Implementation Milestones

1. JSON schema validation for planning drafts and final planning results
2. Concrete OpenClaw worker execution bridge built on top of the PR3 adapter layer
3. File-backed runtime store
4. Richer reporting output and checkpoint resume support
5. CLI / chat entry integration
