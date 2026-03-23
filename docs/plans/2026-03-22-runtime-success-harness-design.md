# Runtime Success Harness Design

**Date:** 2026-03-22

## Goal

Shift the repository's next major delivery phase from "complete the orchestrator kernel" to "increase real task success rate" so this system can become the primary day-to-day coding agent for future development work.

## Context

The repository already has a strong control-plane harness:
- planning mode resolution, debate/direct planning, and DAG conversion
- runtime orchestration with retry, escalation, approval, policy, reporting, and persistence
- goose-backed implementation execution
- external `test-agent` / `review-agent` quality gates
- root harness docs that reduce drift and scope confusion

That foundation is good at:
- keeping ownership boundaries explicit
- preventing obvious planning/runtime drift
- making runs inspectable and recoverable

It is not yet equally strong at the runtime behaviors that most affect real task completion:
- giving workers compact, task-specific local context at the moment of execution
- forcing workers into a reliable build/verify/fix loop before they declare success
- detecting when retries are repeating the same failing strategy
- extracting reusable learning from persisted run traces

In other words, the repository already has a good harness skeleton, but it still leans more toward static guardrails than toward dynamic runtime success optimization.

## Problem Statement

If this agent is going to become the main workhorse for future development, the next phase should optimize for:
- more tasks finishing correctly on the first full run
- fewer "implementation_done but not actually verified" outcomes
- better recovery when the first approach is wrong
- a faster outer loop for improving the harness from real traces rather than intuition alone

## Options Considered

### Option 1: Planning-first upgrades

Focus first on richer planning output:
- add more task metadata
- add more explicit task decomposition rules
- add more acceptance-criteria depth

Pros:
- fits the current repo shape cleanly
- reinforces the existing anti-drift design
- lower runtime complexity than middleware work

Cons:
- does not directly help when the worker fails to understand the live repo state
- does not force stronger self-verification
- does not help much once execution has already gone down a bad path

### Option 2: Runtime-first harness upgrades

Focus first on the runtime seam between orchestrator and worker:
- richer execution guidance in planning outputs
- dynamic local context injection before dispatch
- orchestrator-owned self-verification guardrails
- retry diagnosis and loop detection
- trace analysis for future harness tuning

Pros:
- addresses the phase where most real failures happen
- closely matches the harness-engineering lessons from LangChain
- improves success rate without changing the high-level architecture
- remains model-agnostic and useful across future providers

Cons:
- requires several contract changes across planning, runtime, adapters, and prompts
- adds new orchestration concepts such as middleware and continuation hooks

### Option 3: Eval-first upgrades

Focus first on trace analysis and reporting:
- richer events
- analyzer scripts
- failure categorization

Pros:
- gives a better improvement loop
- low risk to the current runtime path

Cons:
- mostly improves future iterations, not immediate task success
- does not itself cause workers to execute better

## Recommendation

Use **Option 2: Runtime-first harness upgrades**.

The repository already invested heavily in correctness, recovery, and documentation. The next highest-leverage work is to make each live worker attempt more likely to succeed before retry/escalation is needed.

The recommended order is:
1. rich context injection
2. self-verification guardrails
3. retry diagnosis plus loop detection
4. structured trace analysis

This ordering is deliberate:
- self-verification works best once task context is already richer
- retry diagnosis works best once worker outputs include stronger evidence and checklist state
- trace analysis is most valuable after the runtime emits better structured signals

## Chosen Design

### 1. Add execution guidance to planning outputs

Planning tasks should evolve from "who owns this task and what is the acceptance criteria" to "what execution guidance should the runtime inject when this task is dispatched".

The new `execution_guidance` shape should stay compact and operational, for example:
- `must_read_files`
- `verification_commands`
- `environment_checks`
- `definition_of_done`
- `reconsider_signals`

This keeps planning in an implementation-only scope while still making planning outputs more actionable during runtime.

### 2. Build runtime context just-in-time

The orchestrator should prepare worker-facing context from:
- checked-in repo context artifacts
- task-specific execution guidance
- local environment discovery
- prior-attempt evidence
- current runtime policy/time-budget hints

The important design rule is:
**do not force the worker to rediscover everything from scratch if the harness can discover it deterministically.**

### 3. Introduce an orchestrator-owned middleware seam

The runtime needs a clean hook point for behaviors that are neither planning nor worker ownership:
- pre-dispatch context injection
- pre-completion checklist enforcement
- loop detection
- retry diagnosis

These should stay orchestrator-owned rather than being duplicated across goose recipes or implementation prompts.

### 4. Enforce self-verification before external quality gates

Workers should not be allowed to declare a task ready for external quality gates unless they first show they attempted the expected local verification loop.

The external `test-agent` / `review-agent` remain the final evaluators.
The new guardrail is earlier:
- implementation worker must demonstrate build/verify behavior
- orchestrator can continue the task with checklist feedback if the worker stopped too early

### 5. Make retries smarter than raw replay

Retries should carry forward more than the last error string.
They should include:
- structured failure diagnosis
- repeated-pattern detection
- explicit "do not retry the same approach" guidance when warranted
- compact attempt history useful to the next worker attempt

### 6. Close the loop with trace analysis

Persisted runs already exist.
The next step is to make them analyzable at scale by adding richer event structure and a repository-local analyzer that can summarize:
- common blocker categories
- unverified completions
- repeated retry patterns
- common checklist failures
- model- or task-specific weak spots

## Planned PR Sequence

### PR10: Rich context injection

Goal:
- make worker inputs much more execution-ready before any code is written

Primary changes:
- `execution_guidance` in planning/runtime schemas
- runtime context builder
- local environment discovery
- richer worker payloads into OpenClaw and goose
- stronger implementation-role prompts

### PR11: Self-verification guardrails

Goal:
- enforce a build/verify/fix loop before a worker can hand off to external gates

Primary changes:
- runtime middleware seam
- pre-completion checklist middleware
- continuation behavior when implementation is not yet self-verified
- stronger worker prompts/task contract around verification evidence

### PR12: Retry diagnosis and loop detection

Goal:
- prevent retries from repeating the same broken path

Primary changes:
- attempt-history support
- failure diagnosis contracts
- loop detection middleware
- retry handoff improvements

### PR13: Structured trace analysis

Goal:
- make harness improvement data-driven inside the repository

Primary changes:
- richer structured runtime events
- analyzer module plus script
- documented eval workflow for reviewing run failures

## Non-goals

This phase should not:
- replace the orchestrator with a worker-driven control loop
- move final completion ownership out of the external quality gates
- introduce long-lived autonomous agent swarms
- optimize primarily for benchmark aesthetics over day-to-day developer usefulness
- rebuild the planning system from scratch

## Success Criteria

The phase is successful when the repository can show:
- richer worker payloads with deterministic local context and execution guidance
- fewer unverified implementation completions
- retries that provide materially better handoff instructions
- structured run artifacts that can be analyzed for recurring failure modes
- a clear PR-by-PR path that can be executed incrementally without breaking existing invariants

## Verification

This design change is documentation-only.
Verification should cover:
- new plan and roadmap files are present
- README/repo-context references point to the new roadmap
- `git diff --check` passes
