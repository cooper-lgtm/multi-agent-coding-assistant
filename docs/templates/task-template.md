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
