# Plan Runner Script Testing Design

**Date:** 2026-03-19

## Background

The repository already includes goose recipes and GitHub workflow guidance for task-sized PR delivery, but the end-to-end "run an entire plan document" flow still exists only as an operator idea plus ad hoc shell commands.

That gap matters because the desired workflow depends on external systems with different timing semantics:
- goose executes one task-sized slice at a time
- GitHub checks can be watched through `gh pr checks`
- Codex review request workflows finish quickly, but the actual review findings may arrive later as review comments

If the orchestration logic for that loop lives only in an untested shell snippet, the team cannot trust it to:
- wait for the right signals before merge
- react correctly to delayed review findings
- distinguish "review requested" from "review completed"
- stop safely when a task is blocked or a review result is ambiguous

## Goal

Add a repository-local plan runner that can execute one plan document task-by-task while remaining testable through deterministic command stubs and script-level integration tests.

## Non-goals

- replacing goose recipes with a new orchestration runtime
- validating that model-generated code is semantically correct
- adding a production-grade CLI subcommand to `maca`
- mocking the full GitHub API surface
- fully automating every possible PR comment or review edge case in the first change

## Constraints

- `main-orchestrator` remains the only runtime controller for product execution flows
- this runner is developer automation, not a replacement for orchestrator semantics
- each plan task must still map to one task-sized branch / PR / merge loop
- tests must not require live GitHub or live goose execution
- Codex review request workflow success must not be treated as proof that review findings are complete
- merge must wait for required checks and for a bot review verdict on the current PR head SHA

## Planning / Runtime Contract Check

### Current repository support

- `.goose/recipes/execute-next-plan-task.yaml` already defines the single-task delivery contract
- `.github/workflows/ci-tests.yml` defines the pull request test checks
- `.github/workflows/codex-pr-review.yml` requests Codex review, but does not itself contain the eventual review findings
- existing tests already prefer deterministic stubs for goose-facing behavior

### Gap to close

The repository has no checked-in script or tests that prove the higher-level loop behaves correctly across:
- ordered task execution
- required check waiting
- delayed review completion
- repair loops after Codex findings
- safe stop conditions

## Options Considered

### Option 1: Keep a shell script only

Pros:
- fastest to sketch
- close to the final command the user runs

Cons:
- difficult to unit test without brittle subprocess assertions
- hard to model delayed review states cleanly
- logic becomes opaque as polling and retry rules grow

### Option 2: Create a small automation module plus a thin script wrapper

Pros:
- separates state-machine logic from process wiring
- allows deterministic tests with fake command runners
- still gives the user a real script entrypoint

Cons:
- slightly more code structure up front

### Option 3: Promote the feature directly into the main CLI

Pros:
- best eventual product surface

Cons:
- expands scope into CLI productization
- current CLI is intentionally scaffold-level
- weakens focus on proving logic correctness first

## Decision

Use Option 2.

Introduce:
- a small automation module for plan-runner logic
- a script entrypoint that calls the module with real subprocess adapters
- deterministic tests that stub `gh`, `goose`, and polling behavior

## Selected Design

### 1. Automation module

Add a module under `src/automation/` that owns:
- task sequencing
- goose invocation per task
- PR metadata extraction
- required-check waiting
- Codex review polling for the current head SHA
- decision logic for repair, merge, or stop

This module should accept injected command and sleep helpers so tests can run without real subprocesses.

### 2. Thin executable script

Add `scripts/run-plan-doc.mjs` as the operator-facing entrypoint.

The script should:
- parse basic arguments
- instantiate the real shell-command adapter
- call the automation module
- print machine-readable JSON summaries for each task and the overall run

### 3. Deterministic tests

Add two complementary test layers:

- logic tests for the automation state machine using an in-memory fake runner
- script-level integration tests that execute the real script while `PATH` points at fake `gh` and fake `goose` binaries

These tests should prove:
- checks must pass before merge
- terminal required-check buckets like `cancel` or `skipping` stop the loop immediately instead of timing out
- a green Codex request workflow is not enough
- only reviews for the current PR head SHA count
- a zero-finding current-head review is only considered clean after a stable re-poll, so delayed inline comments cannot race the merge
- inline findings force a repair loop
- no findings on the current SHA allow merge and continuation

### 4. Minimal first-slice behavior

The first implementation should optimize for testability over feature breadth.

It should support:
- explicit ordered task hints supplied by the caller
- one branch / PR loop per task
- required check waiting
- current-head Codex review polling
- repair loop re-entry when findings exist

It may defer:
- rich CLI ergonomics
- automatic parsing of arbitrary plan formats beyond the current task heading style
- advanced GitHub review edge cases unrelated to current Codex usage

## Acceptance Criteria

- a checked-in script can drive a task-by-task plan loop without live GitHub in tests
- tests prove that checks and review polling gates are enforced in the correct order
- tests prove the script does not merge on stale or incomplete review signals
- the logic remains small, injectable, and reviewable
- documentation explains that the script validates automation flow, not model output correctness
