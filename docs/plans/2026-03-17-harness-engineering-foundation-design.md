# Harness Engineering Foundation Design

**Date:** 2026-03-17

## Goal

Bring a standard Harness Engineering documentation foundation into this repository so future work no longer depends on chat memory and instead starts from stable repo-local rules.

## Context

The repository already has:
- a working TypeScript MVP for planning, DAG conversion, orchestration, quality gates, retry, reporting, and OpenClaw adapter contracts
- a high-level [README](../../README.md) that explains scope and modules
- a legacy `docs/architecture.md` file that captured only a partial architecture snapshot
- multiple design and implementation plan documents under `docs/plans/`

The repository does **not** yet have the standard Harness entrypoint documents:
- `AGENTS.md`
- `PRODUCT.md`
- root `ARCHITECTURE.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`

Because of that, future contributors still need to reconstruct key rules from chat context, plan docs, and source code.

## Decision

Adopt the same Harness Engineering skeleton used in the reference client PR, but tailor the content to this repository's orchestrator-centric architecture.

The final layout will be:
- add root `AGENTS.md`
- add root `PRODUCT.md`
- add root `ARCHITECTURE.md`
- add `docs/templates/task-template.md`
- add `docs/reviews/recurring-issues.md`
- remove legacy `docs/architecture.md`

## Why This Shape

### Option 1: New root docs and remove the old architecture doc

Pros:
- one canonical architecture entrypoint
- matches the intended Harness repository layout
- clearer reading order for future agents
- reduces drift between legacy and current architecture docs

Cons:
- requires touching existing references to the old file

### Option 2: Keep old architecture doc as a redirect

Pros:
- lower migration cost

Cons:
- still leaves two architecture entrypoints
- invites future divergence

### Option 3: Add only the missing files

Pros:
- least work right now

Cons:
- preserves ambiguity
- fails the user's goal of standardizing the framework

## Recommendation

Use Option 1.

This repository is still early enough that a clean canonical reset is cheaper than carrying legacy doc paths forward.

## Content Strategy

### `AGENTS.md`

Describe:
- project purpose and current engineering priorities
- required reading order
- repo map grounded in current `src/`, `tests/`, `prompts/`, and `docs/`
- golden rules for planning, orchestration, quality gates, retries, and documentation
- task execution expectations
- validation expectations for docs and TypeScript/runtime changes
- handoff and PR expectations

### `PRODUCT.md`

Describe:
- what the product is today: an OpenClaw-native multi-agent orchestration kernel
- primary users: agent builders and workflow engineers
- top priorities: correctness, recoverability, traceability, contract clarity
- non-goals: real execution engine, CLI/chat productization, long-lived agent fleets
- success criteria for planning, DAG execution, quality loops, and extensibility

### `ARCHITECTURE.md`

Describe:
- the end-to-end flow from request intake to final summary
- the layered architecture: planning, validation, DAG build, dispatch, quality gates, retry, reporting
- the role boundaries: orchestrator, planning roles, implementation roles, quality gates
- key contracts in `src/schemas`, `src/planning`, `src/orchestrator`, `src/adapters`, and `src/workers`
- architecture invariants sourced from the current codebase and the referenced Obsidian design

### `docs/templates/task-template.md`

Require non-trivial tasks to state:
- background
- goal
- non-goals
- constraints
- planning/runtime contract check
- acceptance criteria
- affected modules
- risks
- validation steps
- deliverables

### `docs/reviews/recurring-issues.md`

Capture repeat review failures such as:
- planning result drift from runtime assumptions
- quality gates being treated as planning owners
- retry/escalation semantics changing without tests/docs
- adapter/logical-model assumptions drifting from exact-model metadata
- docs lagging behind current contracts

## Migration Rules

1. `docs/architecture.md` will be deleted rather than redirected.
2. `README.md` should point readers to the new root docs.
3. New docs should cite current code structure rather than future aspirational modules.
4. The content should stay focused on the current MVP and adjacent next steps, not a speculative full platform.

## Verification

Because this is a documentation-only change, verification focuses on:
- file presence and path correctness
- internal consistency between README and the new root docs
- `git diff --check`

No runtime test suite is required unless we accidentally modify code or scripts.
