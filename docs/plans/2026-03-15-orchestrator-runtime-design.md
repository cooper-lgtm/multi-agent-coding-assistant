# Orchestrator Runtime Design

**Date:** 2026-03-15

## Goal

Extend the current DAG-based MVP so a run can move past implementation dispatch and coherently execute implementation, quality gates, retry/escalation, dependency blocking, and final reporting with mockable adapters.

## Context

The repository already has:
- typed planning and runtime schemas,
- planning validation,
- DAG construction with model routing for implementation roles,
- a minimal `MainOrchestrator` that stops after implementation dispatch.

The missing slice is the concrete runtime layer. The next MVP step should keep the architecture modular, strongly typed, and easy to replace with real adapters later.

## Approaches Considered

### 1. Expand `MainOrchestrator` into a single state machine file

Pros:
- fastest to wire initially
- minimal file count

Cons:
- mixes dispatch, quality gates, retries, persistence, and reporting
- makes future adapter replacement harder
- weakens type boundaries between runtime phases

### 2. Introduce four small runtime modules and keep `MainOrchestrator` as the coordinator

Pros:
- aligns with the architecture doc
- keeps adapter boundaries explicit
- makes the demo easy to configure
- preserves a single global orchestrator without a monolith

Cons:
- adds a few more files
- requires a slightly richer return type from the orchestrator

### 3. Model quality gates as synthetic DAG tasks

Pros:
- one uniform scheduler

Cons:
- conflicts with the rule that planning only contains implementation tasks
- obscures the difference between planning owners and quality-gate roles
- adds more complexity than this MVP needs

## Recommendation

Use approach 2.

Implementation tasks remain the only DAG nodes. The orchestrator will:
1. find ready implementation tasks,
2. dispatch them through an implementation dispatcher,
3. run quality gates through a separate quality gate runner,
4. consult a retry/escalation manager on failures or `needs_fix`,
5. persist state and emit reporting events throughout,
6. mark blocked descendants when an upstream task ends in a non-recoverable negative state.

## Module Design

### Implementation Dispatcher

- Contract for running a task owned by `frontend-agent` or `backend-agent`
- Default mock implementation for the demo
- Returns structured status, summary, and optional changed-file metadata

### Quality Gate Runner

- Separate contract for `test-agent` and `review-agent`
- Uses explicit role-based model routing for both gate roles
- Returns test/review statuses plus the post-gate task status

### Retry / Escalation Manager

- Encodes retry policy decisions
- Keeps fallback role-based and explicit
- First retry: same model
- Second retry: upgrade model using the next allowed model for the implementation role
- Exhausted retries: preserve `needs_fix`, `failed`, or `blocked` as terminal outcomes

### Reporting Manager

- Central helper for structured runtime events
- Produces a concise run summary for README and demo output

## Flow

1. Build DAG from a validated planning result.
2. Save initial runtime state.
3. While runnable work exists:
   - pick ready tasks,
   - dispatch implementation,
   - save/report,
   - if implementation succeeds, run quality gates,
   - if quality passes, mark `completed`,
   - if implementation or gates fail, ask retry manager for next action,
   - if outcome is terminal-negative, block unresolved dependents.
4. Produce a final summary with counts and per-task status.

## Error Handling

- Unknown dependency cycles remain a planning validation concern.
- Runtime adapters may be mockable and deterministic.
- Dependency-derived blocking is handled in the orchestrator, not delegated.
- The demo should prove the loop end-to-end without requiring real agents.

## Testing / Verification

- Add minimal Node built-in tests against the compiled output.
- Verify:
  - successful orchestration with dependencies,
  - retry escalation upgrades the implementation model explicitly by role,
  - downstream tasks are blocked when an upstream task ends terminal-negative.
