# Codex Exec Review Gate Design

**Date:** 2026-03-19

## Goal

Add a repository-local, local-runner-friendly code review path that runs strict Codex review by calling `codex exec` directly, with Goose automation as the first consumer and the orchestrator quality-gate seam as the follow-on consumer.

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

The missing piece is a real local review implementation that:
- runs locally instead of depending on GitHub-hosted `@codex review`
- emits progress that a local orchestrator can observe
- returns structured findings and infrastructure-failure signals that the Goose repair loop can consume now and the orchestrator quality-gate seam can consume after its remaining contract gaps are closed
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
- `FileBackedRunStore` already persists event logs incrementally once progress events are actually written into runtime state.

There are still three material contract gaps:
- there is no local review adapter yet
- the orchestrator path does not yet guarantee explicit review scope input such as `repo_path`, `base_ref` or `base_sha`, and the exact diff/commit to review
- the current reporting path records events in memory, but it does not persist mid-review progress unless the runner also triggers persistence or writes a sidecar artifact

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

## Phase Sequence

### Phase 1: Replace GitHub review scraping in the Goose automation loop

The first consumer should be the local Goose delivery loop introduced in PR20, or the equivalent task-sized Goose automation entrypoint if PR20 has not landed on the current base branch yet.

That path already has the key review inputs:
- `repoPath`
- `baseBranch`
- task-sized changed files from goose output
- the current task retry loop

Replacing GitHub comment scraping there gives the repository an immediately usable local review path without first extending orchestrator contracts.

If the PR20 automation slice is not present on the branch where this work lands, this phase must either:
- land that automation dependency first, or
- retarget the integration plan to whichever checked-in Goose entrypoint actually exists on the base branch

### Phase 2: Reuse the same local review adapter inside `QualityGateRunner`

The orchestrator should consume the same adapter only after it has an explicit review invocation context and a persistence hook for mid-review progress.

That keeps Phase 1 small and useful while avoiding a partial orchestrator integration that silently widens review scope or misclassifies local review infrastructure failures.

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
- builds the review prompt from repository prompt assets plus explicit review context
- requires explicit review scope input:
  - `repo_path`
  - `base_ref` or `base_sha`
  - reviewed commit or diff target when available
  - changed files when available
  - task metadata and retry handoff context
- requests a stable findings schema
- normalizes Codex output into:
  - clean review
  - actionable findings
  - local review infrastructure failure

The adapter result should be a typed repository contract, separate from the model-output JSON schema. For example:
- `outcome: clean | findings | manual_review_required`
- `findings`
- `overall_correctness`
- `overall_explanation`
- `overall_confidence_score`
- `commands_run`
- `risk_notes`
- `failure_kind` for process/auth/schema/timeout failures when applicable

The JSON schema constrains only the model's successful review payload. It should not be treated as the full adapter contract for infrastructure failures.

The adapter should fail closed:
- if explicit review scope is missing, it should not silently widen to a repository-wide review
- if schema parsing, auth, process execution, or timeouts fail, it should return a review-infrastructure result instead of pretending the patch is clean

Proposed files:
- `src/adapters/codex-exec-review-adapter.ts`
- `prompts/review-agent-codex-exec.md`
- `prompts/review-agent-output-schema.json`
- `docs/reviews/strict-codex-review-rubric.md`

### 3. Integrate the adapter into Goose first

Replace the current GitHub review polling path in the Goose automation loop with local Codex review.

That integration should:
- run local Codex review only after required checks pass
- pass normalized findings back into the existing repair loop as `prior_review`
- stop as `manual_review_required` when local review infrastructure fails or times out
- keep merge safety tied to the task-sized branch/PR flow without relying on GitHub comments as the source of truth

Proposed files:
- `src/automation/plan-runner.ts`
- `scripts/run-plan-doc.mjs`

### 4. Reuse the adapter in the orchestrator quality gate seam

Keep `QualityGateRunner` unchanged at the public boundary, but only wire in the real local review runner after Phase 2 prerequisites exist.

That runner implementation should:
- preserves current test-gate fallback behavior
- invokes the Codex review adapter only when `review_required` is true
- merges review findings back into the existing `QualityGateRunResult`
- records progress events through `ReportingManager` and a persistence hook while the child process is running

Proposed file:
- `src/orchestrator/codex-exec-quality-gate-runner.ts`

### 5. Persist observable progress

Record structured runtime events during review execution, for example:
- `review_gate_spawned`
- `review_gate_progress`
- `review_gate_completed`
- `review_gate_failed`

For Goose automation, persist the raw `codex exec --json` stream and normalized review result as task-level artifacts beside the existing run summary output.

For orchestrator reuse, these events should not rely on `ReportingManager.record()` alone. The runner needs either:
- an explicit `persistProgress` callback that records and immediately saves state, or
- a sidecar artifact writer that survives process interruption before the next orchestrator checkpoint

Without that extra persistence step, mid-review progress remains observable in memory only.

### 6. Separate findings from review infrastructure failure

If Codex returns findings:
- Goose automation should re-enter the repair loop with the normalized findings
- orchestrator integration should mark the gate as `needs_fix`
- concise findings should be stored in `review_feedback`

If local review infrastructure fails or returns malformed output:
- Goose automation should stop as `manual_review_required`
- orchestrator integration must not route the failure back into implementation retry until the runtime distinguishes review-infrastructure failure from author-fixable findings
- stderr, parser evidence, and timeout/auth details should be preserved in `risk_notes`

If no actionable findings are returned:
- mark the gate as `completed`

This keeps repair loops aligned with author-fixable findings instead of conflating them with local review tool failures.

### 7. Treat the strict review rubric as a first-class artifact

Phase 1 should not bury review quality rules inside one prompt file alone.

Add a stable rubric document under `docs/reviews/` so:
- prompt text stays concise
- repository-specific review rules stay reviewable
- future backends can reuse the same review standard
- the SDK phase can inherit the same correctness bar without rewriting policy

## Affected Modules

- `src/adapters/`
- `src/automation/plan-runner.ts`
- `scripts/run-plan-doc.mjs`
- `src/orchestrator/quality-gate-runner.ts`
- `src/orchestrator/main-orchestrator.ts`
- `src/workers/contracts.ts`
- `src/examples/`
- `docs/reviews/`
- `prompts/`
- `tests/`

## Risks

1. `codex exec --json` event parsing may drift if the CLI event contract changes.
2. Review scope may be too broad if explicit diff context is missing and the adapter does not fail closed.
3. Large diffs may need prompt-side guardrails to keep token cost predictable.
4. A failed review process must not silently look like a clean review or an implementation defect.
5. Progress events must not explode `events.jsonl` size on long reviews.

## Acceptance Criteria

- [ ] the repository has a documented local-review path based on `codex exec`
- [ ] the design makes Goose automation the first integration point and keeps orchestrator reuse explicit
- [ ] the design keeps `QualityGateRunner` as the orchestrator seam for the follow-on phase
- [ ] review outcomes map cleanly to Goose `clean` / `findings` / `manual_review_required` now and to orchestrator `completed` / `needs_fix` / `failed` only after the follow-on prerequisites exist
- [ ] review-infrastructure failures are not misclassified as author-fixable implementation retries
- [ ] explicit review scope requirements are defined before orchestrator integration
- [ ] progress reporting is defined in a way that fits current runtime persistence
- [ ] the design adds a repository-visible strict review rubric based on OpenAI's published review practices
- [ ] the design explicitly defers SDK/thread abstraction to a later phase

## Validation

- review the design against `src/orchestrator/main-orchestrator.ts`
- review the design against `src/workers/contracts.ts`
- review the design against `src/storage/file-backed-run-store.ts`
- run `git diff --check`
