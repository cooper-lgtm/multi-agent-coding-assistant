# Three Operating Modes Design

**Date:** 2026-03-19

## Background

The repository already contains two strong technical cores:

- a planning kernel that can turn a request into a validated `planning result`
- a runtime kernel that can turn a validated plan into a dependency-aware execution run

At the same time, the product surface is still described mostly from the inside out:

- planning pipeline
- DAG build
- orchestrator runtime loop
- quality gates
- retry, persistence, and reporting

That is accurate for contributors, but it is not yet the clearest product framing for operators or future entry surfaces.

The system now needs a stable outward-facing mode model so that future CLI, chat, and workflow integrations can say:

1. plan only
2. execute from an existing plan
3. do both end to end

This also creates a clean place to connect the PR19 planning-coordination direction. The coordinator-led planning workflow belongs primarily to the plan-only path, while execution and repair loops belong primarily to the plan-execution path.

## Goal

Define three product-facing operating modes that reuse the same kernel but expose different entry and exit points:

- `all-plan`: go from natural-language request to a reviewed planning artifact and stop
- `task-run`: take an existing planning artifact and execute it through implementation, quality gates, and repair loops
- `end-to-end`: compose `all-plan` and `task-run` into one controlled workflow

The design should leave stable terminology, mode boundaries, and artifact contracts in the repository before implementation details are expanded.

## Non-goals

- implementing new CLI or chat wiring in this change
- deciding every future UX detail for approvals, resumptions, or re-planning
- changing existing ownership rules for `frontend-agent`, `backend-agent`, `test-agent`, or `review-agent`
- introducing separate global orchestrators per mode
- replacing the current runtime kernel in the same change

## Constraints

- `main-orchestrator` remains the only global runtime controller
- planning still outputs implementation tasks only
- `assigned_agent` remains limited to `frontend-agent` and `backend-agent`
- `test-agent` and `review-agent` remain post-implementation quality gates
- `needs_fix`, `blocked`, and `failed` keep their existing runtime meanings
- `planning result` remains the canonical handoff artifact between planning and execution
- exact-model metadata and planning/runtime traces remain visible when available

## Problem Summary

Without an explicit mode model, several product questions stay blurry:

- when should the system stop after producing a plan versus continue into execution
- which artifact is the required input for execution-only workflows
- where coordinator-led planning interaction belongs relative to runtime quality gates
- how future CLI or chat entry points should map to existing planning and runtime modules

The repository has the technical pieces, but not yet the product-level decomposition.

## Options Considered

### Option 1: Keep one generic "run" product surface

Describe the system as one workflow with optional planning and optional execution.

Why not:

- hides artifact boundaries
- makes approval and resume semantics harder to explain
- weakens the distinction between planning-only and execution-only workflows
- gives future CLI and chat surfaces less stable semantics

### Option 2: Expose three operating modes over one shared kernel

Define `all-plan`, `task-run`, and `end-to-end` as separate product modes that reuse the same planning and runtime modules.

Why this is the best fit:

- matches the current architecture without inventing extra orchestrators
- keeps artifact contracts explicit
- gives future product surfaces stable names and expectations
- cleanly separates PR19 planning-coordination work from execution-loop work

### Option 3: Split planning and execution into separate products

Treat planning and execution as mostly independent systems with their own controllers and state models.

Why not:

- adds unnecessary product and implementation drift
- risks duplicating control logic
- conflicts with the current architectural rule that the repository is one orchestrator product with shared contracts

## Decision

Use Option 2.

The repository should present three operating modes built on one shared orchestration kernel:

- `all-plan`
- `task-run`
- `end-to-end`

These are product modes, not separate architectures.
The underlying modules stay shared, but each mode has a different entry artifact, stopping point, and operator expectation.

## Selected Design

### 1. `all-plan` mode

`all-plan` is the planning-only mode.

Purpose:

- take a natural-language request plus repository context
- run planning coordination
- produce a stored `planning result`
- stop before implementation dispatch

Primary flow:

1. intake request and relevant repo context
2. resolve planning mode
3. run direct planning or debate planning
4. perform planner-side review / coordination
5. validate and normalize the final `planning result`
6. write the planning artifact for later execution

Primary output:

- a validated `planning result` document

Mode rules:

- no implementation dispatch
- no `test-agent` or `review-agent` runtime quality gates
- planner-side critique belongs here, not in the execution DAG

PR19 alignment:

- this is the home for coordinator-led planning
- `planning-agent` should become the only user-facing planner here
- a future `ClarifiedPlanningBrief` artifact belongs to this mode
- bounded planner cross-review belongs here

### 2. `task-run` mode

`task-run` is the execution-from-plan mode.
It may also be referred to as task mode or plan-execution mode in user-facing discussions, but the canonical repo label should be `task-run`.

Purpose:

- take an existing `planning result`
- validate it
- convert it to a DAG
- execute implementation and quality gates
- preserve runtime evidence, retries, and recovery

Primary flow:

1. load an existing `planning result`
2. validate the plan artifact
3. build the execution DAG
4. dispatch ready implementation tasks
5. run `test-agent` and `review-agent`
6. retry, escalate, block, pause, resume, or cancel as needed
7. produce final runtime summary artifacts

Primary outputs:

- persisted runtime artifacts
- run summary
- implementation, test, review, and retry evidence

Mode rules:

- no new user-facing planning conversation
- no planner-led clarification loop
- execution repairs stay inside the runtime loop unless a future explicit re-planning handoff is triggered

Future scope:

- the orchestrator may eventually support structured repair or scoped re-assignment decisions here
- those behaviors should still operate on top of the existing runtime kernel rather than replacing it

### 3. `end-to-end` mode

`end-to-end` is the composed mode.

Purpose:

- accept a natural-language request
- run planning
- then continue into execution under the same high-level session

Primary flow:

1. run `all-plan`
2. optionally pause for human approval on the produced plan
3. hand the validated `planning result` into `task-run`
4. complete execution, quality gates, and reporting

Primary outputs:

- planning artifact
- runtime artifacts
- final run summary

Mode rules:

- it is a composition of `all-plan` and `task-run`, not a third bespoke engine
- approvals may sit between the planning and execution phases
- the planning artifact should remain visible even when execution later fails or is paused

## Shared Artifact Model

The three modes should share one artifact ladder:

1. `PlanningRequest`
2. future `ClarifiedPlanningBrief` when coordinator-led planning is implemented
3. `PlanningResult`
4. `ExecutionGraph`
5. `RuntimeState`
6. `RunSummary`

Key boundary:

- `PlanningResult` is the contract between `all-plan` and `task-run`

That contract should stay explicit in docs, schemas, and future entry surfaces.

## Mapping to Current Repository State

### Already strong today

- `task-run` kernel behavior is largely present in the current orchestrator
- `end-to-end` is partially present because the current `run()` flow already creates a plan and executes it
- planning artifacts, runtime persistence, quality gates, retries, and reporting already exist as typed repository concepts

### Still incomplete today

- `all-plan` does not yet have a fully productized artifact-writing surface
- PR19 coordinator-led planning is not yet implemented in code
- debate planning still uses analyzer fan-out plus local synthesis instead of a true planning coordinator
- CLI entry points exist as scaffolding but do not yet map to these three modes operationally

## Entry Surface Guidance

Future entry surfaces should map cleanly:

- `plan` -> `all-plan`
- `run --plan-file <artifact>` or equivalent -> `task-run`
- `run` from natural-language request -> `end-to-end`

The repository should avoid ambiguous entry points that silently blur these boundaries.

## Architecture Rules for the Mode Split

1. Do not create a separate global orchestrator per mode.
2. Keep `PlanningResult` as the planning/execution handoff contract.
3. Keep runtime quality gates only in `task-run` and `end-to-end`.
4. Keep planner-side coordination and critique inside `all-plan`.
5. Treat `end-to-end` as orchestration of two phases, not a parallel shortcut around their contracts.
6. Preserve persistence and reporting semantics across all modes.

## Affected Modules

Likely future implementation touch points:

- `src/schemas/planning.ts`
- `src/schemas/runtime.ts`
- `src/planning/`
- `src/orchestrator/`
- `src/cli/main.ts`
- `src/storage/`
- `src/examples/`
- planning and runtime test suites
- PR19 planning coordination docs and follow-up prompts

## Risks

### Risk 1: Mode names become marketing labels only

If the names are documented but not reflected in entry surfaces and artifacts, the repository will drift back to implicit behavior.

Mitigation:

- keep mode names tied to explicit inputs and outputs

### Risk 2: `end-to-end` bypasses planning artifacts

If the composed mode treats planning as transient instead of producing a stable artifact, recoverability will weaken.

Mitigation:

- always preserve the plan artifact even in `end-to-end`

### Risk 3: `task-run` quietly grows planning behavior

If execution mode starts reopening free-form planning conversations, the product split will blur.

Mitigation:

- keep any future re-planning handoff explicit and artifact-based

### Risk 4: PR19 coordination work lands without mode framing

If coordinator-led planning is implemented without tying it to `all-plan`, the system may still feel architecturally correct but product-wise unclear.

Mitigation:

- treat PR19 follow-up work as primarily a planning-mode enhancement

## Acceptance Checklist

- [ ] three operating modes are named and defined in repo-local docs
- [ ] each mode has a clear input, stopping point, and output artifact
- [ ] the relationship between PR19 planning coordination and `all-plan` is explicit
- [ ] the relationship between current runtime orchestration and `task-run` is explicit
- [ ] `end-to-end` is defined as composition rather than a separate engine

