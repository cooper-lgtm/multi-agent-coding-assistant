# [Task Name] Implementation Plan

Use this template for non-trivial, execution-ready plans.

Global rules already live in:
- `AGENTS.md` for TDD policy, validation expectations, document ownership, and scope discipline
- `PRODUCT.md` and `ARCHITECTURE.md` for current priorities, boundaries, and invariants

Do not restate those repository-wide rules in every task.
Only include task-specific sequencing when order materially affects correctness, risk, or handoff quality.

## Header

```md
# [Task Name] Implementation Plan

**Goal:** [One sentence describing the shipped outcome]

**Architecture:** [2-4 sentences on approach, ownership boundaries, and invariants]

**Tech Stack:** [Frameworks, libraries, tools touched by this task]

---
```

## Required Sections

### Background

Explain the current problem, relevant runtime behavior, and why this task exists now.

### Goal

Define the specific outcome this task must achieve.

### Non-goals

State what this task intentionally will not do.

### Constraints

List hard constraints, for example:
- planning/runtime boundary rules
- allowed owner roles
- quality-gate semantics
- model metadata requirements
- schema or adapter compatibility constraints

### Planning / Runtime Contract Check

If the task touches planning, runtime orchestration, adapters, worker contracts, or prompt ownership, record:
- what current schemas allow
- which tests already lock current behavior
- whether existing plans or design docs define a target state
- whether prompts or adapters are coupled to the change
- whether the task is aligning current behavior, extending it, or documenting a known gap

If the task is doc-only or otherwise outside those layers, say so explicitly instead of leaving the section blank.

### Acceptance Criteria

Write verifiable checklist items, for example:
- [ ] planning/runtime ownership boundaries remain explicit
- [ ] changed contracts stay aligned with schemas and tests
- [ ] docs are updated where assumptions changed
- [ ] validation results are recorded clearly
- [ ] remaining risks are called out

### Affected Modules

List the likely files and modules affected.

Use exact paths when possible:
- Modify: `src/...`
- Create: `src/...`
- Test: `tests/...`
- Docs: `docs/...`

For policy-sensitive or review-gate-sensitive work:
- list the exact allowed file paths, not broad areas such as "review system"
- list exact named policy surfaces when the task depends on checked-in workflow
  governance
- list explicitly prohibited surfaces when the task must stay docs-only or must
  not widen into runner, schema, hook, prompt, or automation work

### Risks

List risks and edge cases worth checking.

If the task is low-risk, say so explicitly instead of omitting the section.

### Validation Plan

List the validation you expect to run, for example:
- focused Node tests
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- note any blocked checks and why

### Deliverables

Final outputs should include, as applicable:
- code changes
- test changes
- doc updates
- validation results
- risk notes

### Task Breakdown

Prefer small tasks that each produce one meaningful checkpoint.
Default to the compact format below.

```md
### Task N: [Small Deliverable]

**Files:**
- Modify: `...`
- Create: `...`
- Test: `...`
- Docs: `...`

**Test First:**
- [Describe the failing test, regression case, or focused behavior to add first]
- Focused command: `...`

If the task is doc-only or config-only with no behavior change, say so explicitly instead of inventing a test-first step.

**Implementation Notes:**
- [Key boundaries, invariants, or caveats]
- [What must not change in this task]

**Validation:**
- `...`
- `...`
```

## Optional Sections

Add these only when they materially help execution.

### Preconditions And Shared Contracts

Use when the task depends on prior work, shared harnesses, migrations, auth contracts, or architectural invariants that must not drift.

### Review Gate Decision Log

Use when the branch may need to record a review-finding disposition such as
`reject_with_evidence`, `defer_with_follow_up`, or `manual_review_required`.

When used, record at least:
- finding fingerprint or exact file/line reference
- review command and scope
- disposition
- in-scope basis
- rationale
- follow-up artifact or owner

### Out Of Scope Follow-ups

Use when adjacent issues are worth recording without expanding the current task.

## When To Expand A Task

Use explicit step-by-step sequencing only when:
- order is critical
- the change is risky or migration-heavy
- the expected RED/GREEN behavior is easy to get wrong
- the plan will be handed to a low-context agent or separate execution session

In that case, expand a task like this:

```md
### Task N: [Risky Or Order-Sensitive Deliverable]

**Files:**
- Modify: `...`
- Test: `...`

**Detailed Sequencing:**
1. Add the failing test for `...`
2. Run `...` and confirm it fails for the expected reason
3. Implement the minimal change in `...`
4. Re-run `...` and confirm it passes
5. Run broader validation: `...`
```

## Authoring Guidance

- Keep the plan concise, but make it executable without chat context.
- Prefer exact file paths over broad module names.
- Prefer task-specific constraints over repeating repo-wide doctrine.
- Name the first failing test target for behavior changes, but do not restate the full TDD doctrine unless sequencing needs to be explicit.
- Keep `Planning / Runtime Contract Check` explicit for architecture-sensitive work.
- For policy-sensitive tasks, name the exact governed files and policy docs so a
  review finding cannot silently widen the branch.
- Use the expanded step-by-step format sparingly.
