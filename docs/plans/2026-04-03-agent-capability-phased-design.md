# Agent Capability Phased Execution Design

## Background

The repository already has a coherent orchestration kernel: planning mode resolution, normalized planning results, dependency-aware runtime scheduling, Goose-backed implementation dispatch, quality gates, retry/escalation, and file-backed runtime persistence are all present in the current baseline.

The next step is not to rebuild that kernel. It is to make the agent system more capable and more inspectable in the seams where planning, implementation handoff, quality evaluation, and task operations meet.

At the same time, execution needs to remain compatible with the repository's Goose PR-sized workflow:
- one checked-in implementation plan document
- one task-sized branch and PR at a time
- required local verification and pre-push review gate
- required GitHub checks
- automatic merge after required checks pass

## Decision

Use one total implementation plan document with four ordered phases:

1. Planning-agent coordination
2. Contract-aware artifact-first handoff
3. Quality-agent deepening
4. Task operations and stage discipline

This keeps Goose execution simple enough for `scripts/run-plan-doc.mjs`, while still giving humans a durable roadmap with explicit boundaries and stop conditions.

## Execution Mode

This design assumes **auto-merge mode**:
- Goose executes one task-sized slice at a time.
- The execution recipe opens or updates the PR and stops at `opened_not_merged`.
- The outer plan runner waits for required GitHub checks.
- If required checks pass, the outer plan runner merges automatically.

If the repository later needs manual review approval before merge, that is a different execution mode and should be captured explicitly in the implementation plan before reuse.

## Cross-Phase Rules

- `main-orchestrator` remains the only global controller.
- Planning outputs implementation tasks only.
- `assigned_agent` remains limited to `frontend-agent` and `backend-agent`.
- `test-agent` and `review-agent` remain quality gates, not planned owners.
- `needs_fix`, `blocked`, and `failed` remain distinct runtime states.
- Each task-sized PR must include at least one docs update.
- Unless a task names a more specific docs target, updating the implementation plan with validation results, changed docs, and residual risks is the default docs update.

## Phase Boundaries

### Phase 1: Planning-Agent Coordination

Purpose:
- align the debate-planning implementation to the existing coordinator-led planning design

Key outcome:
- `planning-agent` becomes the real coordination point
- analyzers consume a frozen clarified brief
- clarification and cross-review stay bounded and structured

Read-first sources:
- `docs/plans/2026-03-17-planning-brief-coordination-design.md`
- `docs/plans/2026-03-17-planning-brief-coordination.md`

### Phase 2: Contract-Aware Artifact-First Handoff

Purpose:
- make implementation and retry handoff explicit without expanding quality-gate semantics yet

Key outcome:
- add `TaskExecutionContract`
- add `ImplementationAttemptReport`
- add `RetryDiagnosisReport`
- thread those surfaces through adapters, runtime middleware, persistence, and reporting

Boundary:
- Phase 2 does **not** own rich `QaReport` semantics for quality gates
- it may make room for later QA artifacts, but Phase 3 owns their contract depth and behavioral uptake

Read-first sources:
- `docs/plans/2026-03-16-worker-execution-bridge-mvp.md`
- `docs/harness-engineering-v2.1-report.zh-CN.md`
- `docs/plans/2026-03-29-pr13a-structured-runtime-event-schema.md`
- `docs/plans/2026-03-29-pr13b-run-trace-analyzer.md`

### Phase 3: Quality-Agent Deepening

Purpose:
- deepen `test-agent` and `review-agent` after runtime already has stronger artifact surfaces

Key outcome:
- introduce structured `QaReport` semantics for quality gates
- make `test-agent` and `review-agent` outputs richer and more reusable
- optionally add bounded internal triad review inside the logical `review-agent`

Boundary:
- quality roles remain evaluators, not task owners

Read-first sources:
- `docs/plans/2026-03-19-codex-exec-review-gate-design.md`
- `docs/plans/2026-03-22-lint-quality-gate-design.md`
- `docs/goose/task-contract.md`

### Phase 4: Task Operations and Stage Discipline

Purpose:
- add a narrow task-centric lifecycle/operator surface only after earlier seams are stable

Key outcome:
- lifecycle and stage metadata
- checkpoint-aware reporting
- operator-read task summaries
- minimal task-session/control scaffolding

Boundary:
- do not jump directly to a large persistent task registry or operator platform

Read-first sources:
- `docs/plans/2026-03-16-persistence-resume-operational-state-design.md`
- `docs/plans/2026-03-23-runtime-success-breakdown.md`

## Task Size Guidance

The implementation plan is intentionally step-heavy because Goose is expected to execute it as PR-sized slices. A task should be split further when any of the following become true:
- the diff crosses too many unrelated seams in one PR
- validation scope grows beyond the task's intended boundary
- the docs update can no longer explain the slice clearly
- the PR stops being reviewable as a single deliverable

The implementation plan may keep explicit `Step 1/2/3/4/5` sequencing when order materially affects correctness or execution stability.

## Expected Outputs Per Task

Each successful task-sized PR should leave behind:
- code changes for exactly one task slice
- focused validation evidence
- at least one docs update
- an updated implementation plan entry recording what landed, what was validated, and what remains risky
