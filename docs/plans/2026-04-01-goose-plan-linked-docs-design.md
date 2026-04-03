# Goose Plan-Linked Docs Design

**Date:** 2026-04-01

## Goal

Make planning and design docs first-class Goose automation artifacts so future
task execution can consume them mechanically instead of relying on chat memory
or a contributor re-explaining the plan by hand.

## Background

The repository already has a strong branch-per-task Goose workflow and compact
worker runtime context injection. What it does not yet have is one explicit,
portable convention that ties these pieces together:

- non-trivial feature work should have one stage design doc
- the implementation plan should point at that design doc
- each task-sized slice should declare the task-specific "read first" docs
- Goose should follow those links automatically later, even when planning
  happened outside Goose

The approved direction is option 2:

- require one design doc plus one implementation plan doc for non-trivial
  feature work
- require each task-sized PR to include at least one docs update
- do not require a separate standalone task doc file for every PR
- let planning happen outside Goose as long as the resulting artifacts are
  checked in and linkable

## Problem Statement

Today Goose can read the active plan path, but the link from:

- plan -> design doc
- plan task -> task-specific read-first docs

is mostly a human convention. That creates two risks:

1. Goose execution can miss the design context that justified a task.
2. Implementation workers can start broad repo exploration before reading the
   task-specific docs that planning already identified.

## Chosen Design

### 1. Add one explicit plan-linked docs convention

Going forward, non-trivial feature work should use two checked-in artifacts:

- one stage design doc
- one implementation plan doc

The implementation plan becomes the durable bridge between outside planning and
later Goose execution.

The convention is intentionally simple:

- every implementation plan includes one top-level
  `**Design Doc:** \`relative/path.md\`` line
- every task section may include one `**Task docs:**` bullet list with
  repository-relative paths

Example:

```md
**Design Doc:** `docs/plans/2026-04-01-example-design.md`

### Task 1: Example slice

**Task docs:**
- `docs/goose/pr-workflow.md`
- `src/automation/example.ts`
```

This keeps the plan readable for humans and easy to parse for automation.

### 2. Keep Goose consumption explicit and mechanical

The plan runner should parse the implementation plan before invoking Goose. For
each task-sized run it should extract:

- the selected task heading
- the linked design doc path, if present
- the selected task's `Task docs` paths, if present

The Goose `execute-next-plan-task` recipe should then receive those linked doc
paths as explicit inputs and read them before broad repo exploration.

This preserves the current control boundary:

- Goose still executes one task-sized PR at a time
- the outer plan runner still owns sequencing and required-check polling
- no new global controller is introduced

### 3. Reuse the existing worker read-first seam

Implementation workers already consume:

- `execution_guidance.must_read_files`
- `runtime_context.task_context_files`

That is the right seam for task-level plan-linked docs. We do not need a new
runtime task contract for this feature. Instead, the repository convention
should state:

- when a task depends on plan-linked docs, those doc paths belong in
  `execution_guidance.must_read_files`
- runtime context injection will then carry them into
  `runtime_context.task_context_files`
- frontend/backend Goose recipes must treat that file queue as the first
  reading pass before broad repo exploration

### 4. Planning may happen outside Goose

This workflow must support a human or another planner producing the design doc
and implementation plan outside Goose first. Goose only needs the checked-in
artifacts later.

That means the automation contract is:

- Goose does not need to own planning to benefit from planning artifacts
- Goose only needs a stable plan format that links the relevant docs
- once those docs are checked in, Goose can consume them deterministically

### 5. Require docs movement in every task-sized PR

Each task-sized PR in this workflow must include at least one docs update.
That docs update does not need to be a separate task doc file. Valid examples
include:

- updating the design doc
- updating the implementation plan task state or linked task docs
- updating Goose workflow docs
- updating root docs or review guidance that changed because of the slice

This keeps the repo recoverable for future agents without forcing extra
standalone task files.

## Non-goals

This feature should not:

- change `main-orchestrator` ownership boundaries
- add new planning owners beyond `frontend-agent` and `backend-agent`
- turn `test-agent` or `review-agent` into planned task owners
- introduce a task registry or task operations layer
- widen `TaskExecutionContract` unless the existing read-first seam is
  insufficient

## Success Criteria

The design is successful when:

- the repository docs define the plan-to-design and task-doc conventions
- the plan runner can parse those links from a checked-in implementation plan
- Goose task execution receives the linked design/task docs explicitly
- implementation workers are instructed to receive task doc paths through
  `execution_guidance.must_read_files` and `runtime_context.task_context_files`
- focused tests lock the parser, Goose recipe inputs, and worker-facing
  read-first behavior

## Verification

Implementation should validate at least:

- `npm run build`
- `node --test tests/plan-runner.test.mjs`
- `node --test tests/run-plan-doc.test.mjs`
- `node --test tests/runtime-context-builder.test.mjs`
- `node --test tests/openclaw-runtime-adapter.test.mjs`
- `node --test tests/orchestrator-goose-runtime.test.mjs`
- `npm run lint`
