# Agent Instructions

This repository uses a Harness Engineering workflow.
The goal is not only to change code, but to keep the planning, orchestration, and quality-loop rules understandable, reviewable, and recoverable for future agents.

## 1. Project Purpose

This project is an OpenClaw-native multi-agent coding orchestrator MVP.
It currently focuses on:
- planning user requests into implementation-only tasks
- converting validated planning results into an execution DAG
- dispatching ready implementation work to `frontend-agent` and `backend-agent`
- running `test-agent` and `review-agent` as quality gates
- applying retries, model escalation, and reporting
- carrying OpenClaw model metadata through planning and runtime flows

Current engineering priority:
**correctness > recoverability > traceability > contract clarity > breadth**

Protect these repo-critical loops first:
- planning mode resolution and planning result normalization
- planning result validation before DAG build
- implementation dispatch and dependency-aware scheduling
- test/review quality gates and `needs_fix` routing
- retry handoff context and model escalation behavior

---

## 2. Reading Order

When starting non-trivial work, read in this order:
1. `README.md` — repo overview, commands, and module layout
2. `PRODUCT.md` — current goals, priorities, and non-goals
3. `ARCHITECTURE.md` — system flow, boundaries, and invariants
4. relevant docs in `docs/plans/`
5. relevant guidance in `docs/reviews/` and `docs/templates/`
6. the source modules and tests you expect to touch

Do not rely only on chat context for architecture or workflow decisions.
The repository docs are the working source of truth.

---

## 3. Repo Map

| Path | Responsibility |
| --- | --- |
| `src/schemas/` | shared planning, runtime, and model metadata contracts |
| `src/planning/` | planning mode resolution, direct/debate planning flow, normalization, synthesis |
| `src/orchestrator/` | DAG build, execution loop, dispatch, quality gates, retries, reporting |
| `src/adapters/` | model routing, exact-model resolution, OpenClaw-facing request/response shaping |
| `src/workers/` | worker execution contracts, blocker categories, retry handoff context |
| `src/storage/` | runtime persistence contracts |
| `src/examples/` | typed fixtures and runnable demos |
| `prompts/` | English prompt assets for planning, implementation, and quality roles |
| `tests/` | compiled-output Node tests for adapters, planning, and runtime behavior |
| `docs/plans/` | designs, implementation plans, and architecture decisions |
| `docs/templates/` | required task framing for non-trivial work |
| `docs/reviews/` | recurring review failures that should become stable guidance |

---

## 4. Golden Rules

### Orchestrator rules
- `main-orchestrator` remains the only global controller.
- Planning may inform implementation, but it must not take over runtime scheduling.
- The execution loop must preserve dependency-aware readiness, quality gates, retry, and blocking semantics.

### Planning rules
- Planning outputs only implementation tasks.
- `assigned_agent` may only be `frontend-agent` or `backend-agent`.
- `test-agent` and `review-agent` are quality gates, not planning owners.
- Cross-domain work should be split into separate tasks instead of hidden inside one owner.

### Runtime rules
- `needs_fix`, `blocked`, and `failed` are distinct states with different recovery behavior.
- Retry decisions should preserve evidence and prior-attempt context.
- Downstream blocking belongs to the orchestrator, not to workers.

### Model rules
- Keep logical model labels and exact model metadata aligned.
- Do not silently drop `model_metadata` when routing or escalating work.
- If an exact model mapping changes, update docs and tests in the same change where practical.

### Scope rules
- Avoid opportunistic refactors outside the stated task.
- If you spot adjacent issues, record them in docs or follow-up notes rather than silently expanding scope.

---

## 5. Task Execution Rules

For non-trivial tasks, use `docs/templates/task-template.md`.
A proper task should define:
- background
- goal
- non-goals
- constraints
- planning/runtime contract check
- acceptance criteria
- affected modules
- risks
- validation steps

If those are missing, narrow the scope before making broad edits.

For architecture-sensitive work, explicitly check:
1. current schemas
2. relevant runtime or planning tests
3. existing plan/design docs
4. prompts or adapter contracts if role behavior is affected

---

## 6. Validation Expectations

Run the narrowest useful checks first.
Typical commands:

```bash
npm run typecheck
npm run test:adapter
npm run test:planning
npm run test:runtime
npm run build
```

For doc-only changes, validate at minimum:

```bash
git diff --check
```

If you cannot run a check, say so explicitly.

---

## 7. Docs Policy

Do not leave important orchestration knowledge only in chat or PR comments.
Write it back to the repo when you add or discover:
- planning/runtime invariants
- model routing or exact-model assumptions
- retry/escalation behavior
- recurring quality-gate failures
- task workflow expectations

Relevant files:
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `docs/plans/`
- `docs/reviews/recurring-issues.md`

---

## 8. Landing the Plane

When ending a work session, complete all applicable steps below.
Work is not complete until changes are committed and pushed.

1. Record follow-up work when needed
2. Run the appropriate validation
3. Push the branch and verify it exists remotely
4. Clean up temporary state
5. Hand off remaining risks and open questions clearly

### Critical rules
- Never leave finished work only in local state
- Never present speculative success without verification
- If push fails, resolve it and retry

---

## 9. Pull Request Policy

All pull requests should clearly state:
- what changed
- why it changed now
- which architecture/runtime rules it follows
- what was validated
- what was not validated

If a PR changes planning, runtime, adapters, or prompts together, call out those cross-module relationships explicitly.
