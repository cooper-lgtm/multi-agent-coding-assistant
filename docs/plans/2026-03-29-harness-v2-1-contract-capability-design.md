# Harness Engineering V2.1 Contract- and Capability-Aware Design

**Date:** 2026-03-29
**Reference:** Anthropic engineering article, *Harness design for long-running apps*  
Source: <https://www.anthropic.com/engineering/harness-design-long-running-apps>

## Goal

Define the next harness iteration after `v2.0-core` so this repository can evolve from a strong runtime-success harness into a contract-aware, capability-aware execution system for longer-running autonomous coding work.

## Context

The repository's `v2.0` direction is already clear:
- richer execution guidance and runtime context injection
- middleware-based self-verification guardrails
- retry diagnosis and loop detection
- structured trace analysis

That work strengthens the runtime control loop significantly. It improves the chance that a worker attempt starts with the right context, verifies before handoff, and retries with better information.

Anthropic's long-running harness article adds a different layer of insight. The most valuable ideas are not:
- "add more top-level agents"
- "copy planner / generator / evaluator literally"

The most valuable ideas are:
- negotiate a concrete build contract before implementation
- separate generation from evaluation when judgment quality matters
- treat harness complexity as model-capability dependent rather than fixed forever
- preserve structured artifacts between long-running steps so later work can resume cleanly

This design adapts those lessons to this repository's existing orchestrator-centric architecture.

## Problem Statement

Even after `v2.0-core` lands, three gaps are likely to remain:

### 1. Execution starts without a formal attempt contract

The repository will have planning output, execution guidance, runtime context, and checklist continuation. But there is still a gap between:
- the high-level implementation task
- and the exact thing this specific worker attempt is expected to deliver and verify

Without that contract layer, future long-running attempts can still drift even when context injection is strong.

### 2. Harness policy is still too static

The current roadmap assumes a mostly fixed harness shape. Anthropic's article argues for the opposite discipline:
- when models improve, some scaffold becomes unnecessary
- when tasks move beyond the model's reliable boundary, new scaffold becomes worthwhile

This repository needs a way to express that variability directly in runtime policy.

### 3. Runtime artifacts are not yet first-class handoff objects

The repository already has snapshots, events, and retry handoff. But long-running autonomous work benefits from more explicit artifacts such as:
- execution contract
- implementation result artifact
- QA artifact
- retry diagnosis artifact

These should become structured operational objects, not just implicit state fields spread across the runtime.

## Options Considered

### Option 1: Stop after `v2.0-core`

Pros:
- simplest path
- keeps current architecture stable

Cons:
- leaves no formal contract layer between planning and implementation
- leaves harness complexity static instead of model-aware
- weakens long-running artifact handoff for future automation

### Option 2: Copy Anthropic's planner / generator / evaluator structure directly

Pros:
- closest to the reference article
- easy to explain conceptually

Cons:
- conflicts with the repository's orchestrator-first architecture
- risks turning quality roles into informal task owners
- encourages a second control loop beside `main-orchestrator`

### Option 3: Add a contract- and capability-aware layer on top of the current orchestrator

Pros:
- keeps the repository's strongest invariants intact
- captures the most valuable lessons from Anthropic
- improves long-running autonomy without replacing the typed orchestrator kernel

Cons:
- requires new artifact and policy concepts
- adds design work around when extra harness steps are worth the cost

## Recommendation

Use **Option 3**.

Do not replace the current architecture.
Do extend it with three new ideas:
- task execution contracts
- capability-aware harness policy
- artifact-first handoff and analysis

## Chosen Design

### 1. Add a `TaskExecutionContract` runtime artifact

Before a worker attempt begins, the runtime should materialize a compact execution contract for that attempt.

This artifact should answer:
- what this attempt is trying to deliver
- what is explicitly out of scope for this attempt
- which acceptance points matter most right now
- which verification steps are required before handoff
- which risks and QA focus points deserve attention

The contract should be derived from:
- planning task data
- execution guidance
- runtime context
- prior attempt history
- current policy profile

The important rule is that this is **not** a second planner.
It is an execution-time artifact that narrows a planned task into an attempt-ready contract.

### 2. Add a pre-dispatch contract check

For higher-risk or longer-running tasks, the runtime should be able to verify that the next attempt's contract is coherent before large implementation work starts.

This does **not** mean introducing a second global controller.
It means the orchestrator can optionally run a bounded pre-dispatch contract check that validates:
- the scope is concrete
- verification expectations are testable
- the attempt is not obviously repeating the same broken plan

This check can remain orchestrator-owned and narrow. It should not turn `review-agent` into a planning owner.

### 3. Make harness policy capability-aware

The runtime should stop assuming that every task deserves the same harness depth.

Introduce a policy layer that can decide, per task or per run:
- whether a pre-dispatch contract check is required
- whether only final QA is needed or a stronger intermediate evaluator loop is worthwhile
- whether continuous session execution is acceptable or whether resets/artifact handoff are safer
- how much evaluator depth is justified by the task's risk and current model capability

This design treats harness complexity as adaptive:
- use less scaffold when the model handles the task reliably
- use more scaffold when the task is beyond the current reliable boundary

### 4. Make attempt artifacts first-class

The runtime should persist explicit attempt artifacts such as:
- `task_execution_contract`
- `implementation_attempt_report`
- `qa_report`
- `retry_diagnosis_report`

These artifacts should be structured, compact, and linked to task attempts.

They should become:
- the handoff surface for long-running work
- the analysis surface for later evals
- the operator surface for future task-centric tooling

### 5. Add a harness ablation workflow

Anthropic's article makes an important process point: when models improve, old scaffold should be re-tested rather than assumed necessary forever.

This repository should adopt an explicit harness-ablation workflow:
- choose a stable set of representative tasks
- run them with different harness profiles
- compare trace outcomes, costs, duration, and failure patterns
- record which scaffold is still load-bearing

This keeps the harness from only growing.

## Architecture Fit

This design intentionally preserves the current repository's core invariants:

1. `main-orchestrator` remains the only global controller.
2. Planning continues to output implementation tasks only.
3. `assigned_agent` stays limited to `frontend-agent` or `backend-agent`.
4. `test-agent` / `review-agent` remain evaluators, not planning owners.
5. Retry and model escalation remain orchestrator-owned policy.

What changes is the richness of the runtime artifact and policy layer, not the existence of a second conductor.

## Non-goals

`v2.1` should not:
- replace the typed orchestrator kernel with a free-form multi-agent conversation loop
- add long-lived autonomous swarms
- move global scheduling into workers
- auto-edit roadmap or policy from analyzer output
- prioritize remote-control or hosted operator surfaces ahead of runtime correctness

## Proposed `v2.1` PR Sequence

### V2.1a: Task execution contract schema and artifact model

Goal:
- define the contract and artifact structures

Primary changes:
- runtime schema additions for execution contracts and attempt artifacts
- worker contract updates
- persistence/reporting hooks for those artifacts

### V2.1b: Pre-dispatch contract materialization and contract check

Goal:
- build attempt contracts just before dispatch and optionally validate them for higher-risk tasks

Primary changes:
- orchestrator pre-dispatch contract builder
- bounded contract-check middleware or validator
- visible contract artifacts in runtime state

### V2.1c: Capability-aware harness policy

Goal:
- let the runtime choose lighter or heavier harness modes per task/run

Primary changes:
- harness profile model
- policy-engine extensions for profile selection
- model/task/risk-aware gating rules

### V2.1d: Artifact-first task attempt reporting

Goal:
- make attempt artifacts easy to inspect, compare, and hand off

Primary changes:
- task-attempt artifact persistence
- richer task-centric reports
- cleaner input for future task-ops work

### V2.1e: Harness ablation and comparative eval workflow

Goal:
- make harness growth evidence-driven and reversible

Primary changes:
- curated eval task set
- comparison script or workflow
- docs for deciding when scaffold is still worth its cost

## Sequencing Rule

Do **not** start `v2.1` before `v2.0-core` is complete.

`v2.0-core` in this repository means:
- PR35 runtime middleware seam
- PR11b checklist continuation
- PR12 retry diagnosis and loop detection
- PR13a structured runtime events
- PR13b trace analyzer and workflow

The contract- and capability-aware layer depends on those foundations.

## Success Criteria

`v2.1` is successful when the repository can show:
- implementation attempts begin from explicit execution contracts
- harness depth varies intentionally by capability/risk instead of being fixed
- long-running attempts hand off through structured artifacts rather than implicit state alone
- future harness simplification is evidence-driven, not only additive

## Verification

This design change is documentation-only.

Recommended doc-only verification:
- `git diff --check`
