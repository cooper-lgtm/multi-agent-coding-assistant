# Multi-Agent Coding Assistant

A TypeScript implementation of an OpenClaw-native orchestrator system for:
- planning user requests into structured implementation tasks,
- converting planning output into an execution DAG,
- dispatching ready tasks to implementation workers,
- running post-implementation quality gates,
- handling retry, escalation, and reporting.

## Documentation Entry Points

Start here before non-trivial changes:
- `PRODUCT.md`: current goals, priorities, and non-goals
- `ARCHITECTURE.md`: end-to-end system flow, role boundaries, and invariants
- `AGENTS.md`: contributor workflow, repo map, and validation expectations
- `docs/templates/task-template.md`: standard task input for non-trivial work
- `docs/reviews/recurring-issues.md`: repeated review failures worth preventing

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
- a goose-backed implementation dispatch path that keeps `frontend-agent` / `backend-agent` work at the worker seam while preserving external quality gates
- an OpenClaw-facing adapter layer with typed planning/worker envelopes, alias-to-exact-model resolution, and mock runtime adapter stubs
- a richer worker execution bridge MVP that carries changed files, blocker metadata, evidence, and retry handoff context through runtime reporting
- approval controls that can pause after planning until a human explicitly approves execution
- a policy engine that keeps max parallelism, retry budgets, role-specific fallback chains, and high-risk manual-review guardrails in the orchestrator layer
- durable file-backed run persistence with manifest, snapshot, and event-log artifacts plus checkpoint resume and cooperative pause/cancel control

## Current Structure

- `docs/`: plans, templates, prompt notes, roadmap items, and review guidance
- `prompts/`: English prompt assets for planning and worker roles
- `src/schemas/`: shared runtime and planning types
- `src/adapters/`: model routing, exact-model resolution, and OpenClaw runtime integration adapters
- `src/planning/`: planning contracts, mode resolution, normalization, synthesis, mock planners/analyzers, controller facade, pipeline service
- `src/orchestrator/`: DAG builder, main orchestrator, implementation dispatch, quality gates, retry/escalation, reporting
- `src/examples/`: typed planning fixtures plus runnable planning, orchestration, and OpenClaw adapter demos
- `src/storage/`: runtime state persistence contracts plus in-memory and file-backed run stores
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

- `implementation-dispatcher`: dispatches ready implementation tasks to `frontend-agent` or `backend-agent`, including a goose-backed dispatcher option
- `approval-manager`: keeps confirm-before-run approval as an orchestrator concern instead of pushing it into worker adapters
- `policy-engine`: applies runtime budget and safety rules before dispatch without pushing orchestration policy into goose recipes
- `quality-gate-runner`: runs `test-agent` and `review-agent` after implementation completes
- `retry-escalation-manager`: applies the runtime retry policy and explicit per-role model fallback
- `reporting-manager`: records runtime events and builds concise run summaries
- runtime task records now persist changed files, blocker category/message, implementation evidence, test evidence, review feedback, and the latest retry handoff

## Persistence and Resume

- Runs can now persist under `state/runs/<run-id>/`
- Each run directory contains:
  - `manifest.json`: compact operational metadata, task counts, and control flags
  - `runtime.json`: the full typed `RuntimeState` snapshot and source of truth
  - `events.jsonl`: line-delimited runtime events for inspection and debugging
- Resume is checkpoint-based, not replay-based
- `execution_control.mode=confirm-before-run` can pause immediately after planning and persist a waiting-for-approval state
- `budget_policy` now persists the effective orchestration policy, including task retry overrides and high-risk manual-review guardrails, on the runtime snapshot
- `implementation_done` is treated as a stable checkpoint so resumed runs can continue into quality gates without re-dispatching implementation work
- `pause` and `cancel` are cooperative: the orchestrator stops at safe checkpoints instead of force-interrupting active workers

## Adapter Modules

- `goose-worker-adapter`: shells out to goose implementation recipes and normalizes structured worker output
- `goose-process-runner`: serializes recipe params into non-interactive goose CLI invocations
- `openclaw-model-resolver`: maps logical labels and exact ids to provider-aware model metadata
- `openclaw-runtime-adapter`: standardizes planning and worker request/result/error envelopes for OpenClaw-facing execution
- `model-router`: keeps role-based fallback ordering while attaching exact-model metadata when available

## Demo

Example artifacts included in this MVP:
- `src/examples/planning-fixtures.ts`: typed direct, debate, and runtime planning fixtures
- `src/examples/openclaw-adapter-fixtures.ts`: typed OpenClaw request-envelope fixtures for planning and worker roles
- `src/examples/run-openclaw-adapter-demo.ts`: a runnable OpenClaw adapter-layer demo
- `src/examples/run-goose-worker-demo.ts`: a runnable goose-backed implementation dispatch demo using a stubbed goose process
- `src/examples/run-persistence-demo.ts`: a runnable persistence/pause/resume demo that writes run artifacts under `state/runs/`
- `src/examples/run-planning-demo.ts`: a runnable planning pipeline demo with direct and debate flows
- `src/examples/run-orchestration-demo.ts`: a runnable mock orchestration flow
- `tests/orchestrator-e2e.test.mjs`: goose-backed golden-scenario coverage for happy-path, retry recovery, needs-fix, and blocked-runtime regressions
- `tests/fixtures/planning/direct-plan-golden.json`: golden planning snapshot for the stable direct-plan fixture
- `tests/fixtures/runtime/goose-needs-fix-golden.json`: golden runtime summary for exhausted external review feedback
- `tests/fixtures/runtime/goose-blocked-golden.json`: golden runtime summary for repository prerequisite blockers
- `docs/evals/known-limitations.md`: scope notes for deterministic goose evaluation coverage
- `tests/orchestrator-goose-runtime.test.mjs`: compiled-output runtime checks for goose-backed implementation dispatch with external quality gates
- `tests/file-backed-run-store.test.mjs`: compiled-output checks for manifest/runtime/event-log persistence and inspection helpers
- `tests/openclaw-model-resolution.test.mjs`: compiled-output checks for alias resolution and exact-model metadata
- `tests/openclaw-runtime-adapter.test.mjs`: compiled-output checks for planning/worker envelope shaping
- `tests/orchestrator-persistence.test.mjs`: compiled-output checks for checkpoint resume plus cooperative pause/cancel behavior
- `tests/planning-mode-resolution.test.mjs`: compiled-output checks for `auto`/`direct`/`debate` resolution
- `tests/planning-pipeline.test.mjs`: compiled-output checks for direct planning, debate synthesis, and DAG conversion
- `tests/orchestrator-runtime.test.mjs`: compiled-output runtime checks for success, retry escalation, and dependency blocking

Useful commands:

```bash
npm run typecheck
npm run build
npm run test:e2e
npm run demo:goose
npm run demo:persistence
npm run test:adapter
npm run test:planning
npm run test:runtime
npm run demo:orchestrator
npm run demo:adapter
npm run demo:planning
npm run cli -- --help
npm run build && node scripts/run-plan-doc.mjs --repo-path "$(pwd)" --plan-path docs/plans/<plan>.md --base-branch main
```

## Plan Runner Script

The repository now includes a scriptable plan runner at `scripts/run-plan-doc.mjs`.

Run `npm run build` before invoking it so `dist/index.js` matches the current checked-out TypeScript sources.

It is aimed at the workflow where one plan document should execute as a sequence of:
- one task-sized branch
- one PR
- required checks
- Codex review on the current head SHA
- merge only after the current review is clean

Important behavior:
- `--checks-timeout-ms` and `--review-timeout-ms` are available for explicit gate timeouts
- both gates default to a 30 minute timeout when flags are omitted
- timeout does not report `failed`; it returns `manual_review_required` so a human can inspect the PR and decide how to proceed

The first implementation focuses on control-flow correctness and testability.
Its regression surface lives in:
- `tests/plan-runner.test.mjs`
- `tests/run-plan-doc.test.mjs`
- `tests/fixtures/fake-bin/`

Those tests validate the automation logic deterministically; repository tests and human/review feedback still validate whether the generated code itself is correct.

## CLI Entry Points

The repository now ships a lightweight CLI scaffold at `src/cli/main.ts` (compiled to `dist/cli/main.js`) with stable command/flag surfaces:

- Commands: `plan`, `run`, `resume`
- Flags: `--repo-path`, `--planning-mode`, `--execution-runtime=mock|goose`, `--output=json|text`

Current behavior is intentionally minimal: it exposes the delivery interface and returns structured placeholders while deeper command wiring remains follow-up work.


## Next Implementation Milestones

1. JSON schema validation for planning drafts and final planning results
2. Replace the PR4 mock worker bridge with the full real execution engine
3. Richer operational tooling and CLI / chat entry integration on top of persisted run state
4. Multi-run inspection and management surfaces for persisted manifests and event logs
5. Stronger concurrency guarantees if the runtime grows beyond the current single-writer model
