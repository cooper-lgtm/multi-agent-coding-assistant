# Task Template

## Background
Explain the current problem, relevant runtime behavior, and why this task exists now.

## Goal
Define the specific outcome this task must achieve.

## Non-goals
State what this task will intentionally not do.

## Constraints
List hard constraints, for example:
- planning/runtime boundary rules
- allowed owner roles
- quality-gate semantics
- model metadata requirements
- schema or adapter compatibility constraints

## Planning / Runtime Contract Check
If the task touches planning, runtime orchestration, adapters, worker contracts, or prompt ownership, record:
- what current schemas allow
- which tests already lock current behavior
- whether existing plans/design docs define a target state
- whether prompts or adapters are coupled to the change
- whether the task is aligning current behavior, extending it, or documenting a known gap

## Acceptance Criteria
Write verifiable checklist items, for example:
- [ ] planning/runtime ownership boundaries remain explicit
- [ ] changed contracts stay aligned with schemas and tests
- [ ] docs are updated where assumptions changed
- [ ] validation results are recorded clearly
- [ ] remaining risks are called out

## Affected Modules
List the likely files and modules affected.

## Risks
List risks and edge cases worth checking.

## Validation Steps
List the validation you expect to run, for example:
- focused Node tests
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- note any blocked checks and why

## Deliverables
Final outputs should include, as applicable:
- code changes
- test changes
- doc updates
- validation results
- risk notes

## Plan-Linked Docs Handoff
For non-trivial feature work in the Goose workflow:
- create one stage design doc and one implementation plan doc
- link the plan to the design doc with
  `**Design Doc:** \`docs/plans/example-design.md\``
- list task-sized read-first artifacts under `**Task docs:**` inside each
  `### Task N:` section of the implementation plan
- if an implementation task should read those docs during runtime, include the
  relevant paths in `execution_guidance.must_read_files`
- each task-sized PR should include at least one docs update, but it does not
  need a separate standalone task doc file
