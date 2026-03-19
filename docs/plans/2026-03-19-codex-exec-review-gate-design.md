# Codex Exec Review Gate Design

**Date:** 2026-03-19

## Goal

Add a repository-local, local-runner-friendly code review path that lets the orchestrator run strict Codex review as the `review-agent` quality gate by calling `codex exec` directly.

## Context

This repository already has the right runtime seams for a local review worker:
- `MainOrchestrator` delegates quality work through `QualityGateRunner`.
- task state, evidence, and retry handoff already persist into `RuntimeState`.
- `FileBackedRunStore` already writes `events.jsonl`, `runtime.json`, and `manifest.json`.
- the repository already uses external-process adapters for worker execution through `goose-process-runner.ts`.

OpenAI's published Codex review example also gives a strong baseline for this phase:
- review should focus on correctness, performance, security, maintainability, and developer experience
- findings should be actionable and introduced by the diff
- comments should be short, direct, and tied to exact file/line locations
- review should end with an overall correctness verdict and confidence score

The GPT-5-Codex prompting guidance adds one more directly relevant rule:
- keep the stable review prompt minimal and high-signal instead of over-prompting

The missing piece is a real review gate implementation that:
- runs locally instead of depending on GitHub-hosted `@codex review`
- emits progress that a local orchestrator can observe
- returns structured findings that fit current `needs_fix` / `completed` / `failed` semantics
- keeps the existing orchestrator and persistence model intact

## Non-goals

- do not add SDK-managed threads or long-lived Codex sessions in this phase
- do not replace the implementation dispatcher runtime
- do not redesign `QualityGateRunner` public contracts
- do not implement repository-wide GitHub review automation in this phase
- do not solve `test-agent` execution beyond preserving the current mock/fallback behavior

## Constraints

- keep `main-orchestrator` as the only global controller
- keep `QualityGateRunner` as the seam the orchestrator depends on
- preserve `completed` / `needs_fix` / `failed` runtime semantics
- preserve retry handoff evidence and existing `review_feedback` fields
- keep the solution runnable on a local machine with explicit process-level observability
- persist enough progress metadata that resumed runs can explain what happened even if a `codex exec` process exits unexpectedly

## Planning / Runtime Contract Check

Current runtime contracts already support most of the required data path:
- `QualityGateRunner.run(task, runtime)` returns a structured result with `review_feedback`, `risk_notes`, `commands_run`, and status fields.
- `RuntimeEvent.type` is an open string field, so Codex-specific progress events can be recorded without a schema migration.
- `WorkerExecutionContext` already carries changed files and prior review feedback, which is enough to scope a review request and to preserve retry context.
- `FileBackedRunStore` already persists event logs incrementally, so streamed `codex exec --json` events can be appended via the normal reporting path.

The main contract gap is that there is no local review adapter yet.

## Options

### Option 1: Run `codex exec --json` as a local child process

Pros:
- matches the repository's current process-adapter pattern
- easy to monitor from a local orchestrator
- works with file-backed run persistence and current event logging
- simple failure boundaries: spawn, stream, parse, normalize

Cons:
- process lifecycle and JSONL parsing need careful handling
- no built-in thread/session abstraction yet

### Option 2: Skip `codex exec` and implement directly on `@openai/codex-sdk`

Pros:
- richer runtime primitives for future multi-step interactions
- cleaner long-term surface once abstraction exists

Cons:
- introduces session/thread lifecycle before this repository has a Codex runtime seam
- raises the implementation surface area for the first real review gate
- weaker fit for the repository's current external-process adapter model

### Option 3: Delegate review to GitHub-hosted `@codex review`

Pros:
- smallest code change inside this repository

Cons:
- review no longer runs inside the local orchestrator loop
- poor runtime observability from the local runner
- rate limits and control sit outside this repository
- findings are harder to normalize into runtime state and retries

## Recommendation

Use Option 1.

This repository is already built around explicit adapters, local orchestration, and file-backed operational state. `codex exec --json` matches that architecture now, while keeping the door open for a later `CodexRuntimeAdapter` abstraction.

## Final Design

### 1. Add a dedicated Codex process runner

Create a small adapter beside `goose-process-runner.ts` that:
- spawns `codex exec`
- supports `--json`
- captures `stdout`, `stderr`, exit code, and parsed event lines
- surfaces incremental callbacks so the orchestrator can record progress as runtime events

Proposed file:
- `src/adapters/codex-exec-process-runner.ts`

### 2. Add a review-only normalization layer

Create a Codex review adapter that:
- builds the review prompt from repository prompt assets plus task context
- scopes the review using `task.changed_files` when available
- requests a stable findings schema
- normalizes Codex output into:
  - `review_status`
  - `review_feedback`
  - `risk_notes`
  - `commands_run`
  - `summary`
  - `status = completed | needs_fix | failed`

Proposed files:
- `src/adapters/codex-exec-review-adapter.ts`
- `prompts/review-agent-codex-exec.md`
- `prompts/review-agent-output-schema.json`
- `docs/reviews/strict-codex-review-rubric.md`

### 3. Compose review execution into the existing quality gate seam

Keep `QualityGateRunner` unchanged at the public boundary.

Add a real runner implementation that:
- preserves current test-gate fallback behavior
- invokes the Codex review adapter only when `review_required` is true
- merges review findings back into the existing `QualityGateRunResult`
- records progress events through `ReportingManager` while the child process is running

Proposed file:
- `src/orchestrator/codex-exec-quality-gate-runner.ts`

### 4. Persist observable progress

Record structured runtime events during review execution, for example:
- `review_gate_spawned`
- `review_gate_progress`
- `review_gate_completed`
- `review_gate_failed`

These events should be written through the existing reporting path so they land in:
- `runtime.events`
- `state/runs/<run-id>/events.jsonl`

### 5. Keep retry semantics unchanged

If Codex returns findings:
- mark the gate as `needs_fix`
- store the concise findings in `review_feedback`

If the process fails or returns malformed output:
- mark the gate as `failed`
- preserve stderr / parser evidence in `review_feedback` or `risk_notes`

If no actionable findings are returned:
- mark the gate as `completed`

This keeps `MainOrchestrator.applyRetryDecision()` unchanged.

### 6. Treat the strict review rubric as a first-class artifact

Phase 1 should not bury review quality rules inside one prompt file alone.

Add a stable rubric document under `docs/reviews/` so:
- prompt text stays concise
- repository-specific review rules stay reviewable
- future backends can reuse the same review standard
- the SDK phase can inherit the same correctness bar without rewriting policy

## Affected Modules

- `src/adapters/`
- `src/orchestrator/quality-gate-runner.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/workers/contracts.ts`
- `src/examples/`
- `docs/reviews/`
- `prompts/`
- `tests/`

## Risks

1. `codex exec --json` event parsing may drift if the CLI event contract changes.
2. Review scope may be too broad if `task.changed_files` is empty or stale.
3. Large diffs may need prompt-side guardrails to keep token cost predictable.
4. A failed review process must not silently look like a clean review.
5. Progress events must not explode `events.jsonl` size on long reviews.

## Acceptance Criteria

- [ ] the repository has a documented local-review path based on `codex exec`
- [ ] the design keeps `QualityGateRunner` as the orchestrator seam
- [ ] review outcomes map cleanly to `completed`, `needs_fix`, and `failed`
- [ ] progress reporting is defined in a way that fits current runtime persistence
- [ ] the design adds a repository-visible strict review rubric based on OpenAI's published review practices
- [ ] the design explicitly defers SDK/thread abstraction to a later phase

## Validation

- review the design against `src/orchestrator/main-orchestrator.ts`
- review the design against `src/workers/contracts.ts`
- review the design against `src/storage/file-backed-run-store.ts`
- run `git diff --check`
