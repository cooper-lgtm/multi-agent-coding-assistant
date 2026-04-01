# Goose Plan-Linked Docs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Make Goose automatically consume linked design/task docs from an
implementation plan and keep task doc paths flowing to implementation workers
through the existing execution-guidance and runtime-context seams.

**Architecture:** Add a small Markdown plan parser in the automation layer,
pass the linked design/task doc paths into the Goose `execute-next-plan-task`
recipe, and document that task-level read-first docs belong in
`execution_guidance.must_read_files` so runtime context injection carries them
to implementation workers. This preserves the current orchestrator and worker
ownership boundaries.

**Tech Stack:** TypeScript, Node.js built-in test runner, Goose recipes,
Markdown workflow docs

---

**Design Doc:** `docs/plans/2026-04-01-goose-plan-linked-docs-design.md`

## Workflow Contract

- Non-trivial feature work should have exactly one stage design doc and one
  implementation plan doc.
- Each task-sized PR must include at least one docs update, but it does not
  need a separate standalone task doc file.
- Task-specific "read first" docs should be listed under `**Task docs:**`
  inside the relevant `### Task N:` section of the implementation plan.
- When a planned implementation task needs those docs at runtime, the task doc
  paths should be included in `execution_guidance.must_read_files`.

### Task 1: Define the plan-linked docs workflow in repository docs

**Files:**
- Create: `docs/plans/2026-04-01-goose-plan-linked-docs-design.md`
- Create: `docs/plans/2026-04-01-goose-plan-linked-docs.md`
- Modify: `README.md`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `docs/goose/task-contract.md`
- Modify: `docs/templates/task-template.md`

**Task docs:**
- `README.md`
- `docs/goose/pr-workflow.md`
- `docs/goose/task-contract.md`
- `docs/templates/task-template.md`

**Step 1: Write the failing workflow expectation**

Record the exact convention in docs before changing the automation:

- plan doc has one linked design doc
- task sections can list `Task docs`
- Goose may consume planning artifacts created outside Goose later
- each task-sized PR still needs a docs update

**Step 2: Update the docs with the approved contract**

Document the convention in the root workflow docs and Goose-specific docs
without introducing a required standalone task doc file.

**Step 3: Verify the docs are well-formed**

Run:

```bash
git diff --check
```

Expected: pass

### Task 2: Parse linked design/task docs and pass them into Goose execution

**Files:**
- Create: `src/automation/plan-documents.ts`
- Modify: `src/index.ts`
- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `.goose/recipes/execute-next-plan-task.yaml`
- Test: `tests/plan-runner.test.mjs`
- Test: `tests/run-plan-doc.test.mjs`

**Task docs:**
- `docs/plans/2026-04-01-goose-plan-linked-docs-design.md`
- `docs/plans/2026-04-01-goose-plan-linked-docs.md`
- `.goose/recipes/execute-next-plan-task.yaml`
- `scripts/run-plan-doc.mjs`

**Step 1: Write the failing tests**

Add focused coverage that proves:

- the plan parser extracts task headings, one linked design doc, and per-task
  `Task docs`
- `runPlanTaskSequence` forwards linked doc metadata to task execution
- `run-plan-doc` appends Goose params for linked design/task docs when present
- the Goose recipe tells the worker to read those linked docs first

**Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npm run build
node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs
```

Expected: fail because the parser and recipe inputs do not exist yet

**Step 3: Implement the minimal parser and wiring**

Keep the implementation small:

- parse only the documented convention
- treat missing linked docs as an empty optional feature
- do not break older plans that only have task headings

**Step 4: Re-run the focused tests**

Run:

```bash
npm run build
node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs
```

Expected: pass

### Task 3: Lock task-doc propagation through runtime context and worker guidance

**Files:**
- Modify: `docs/goose/task-contract.md`
- Modify: `.goose/recipes/frontend-implementation.yaml`
- Modify: `.goose/recipes/backend-implementation.yaml`
- Test: `tests/runtime-context-builder.test.mjs`
- Test: `tests/openclaw-runtime-adapter.test.mjs`
- Test: `tests/orchestrator-goose-runtime.test.mjs`

**Task docs:**
- `docs/goose/task-contract.md`
- `src/orchestrator/runtime-context-builder.ts`
- `src/adapters/openclaw-runtime-adapter.ts`
- `tests/runtime-context-builder.test.mjs`

**Step 1: Write or update the failing assertions**

Lock the convention that task doc paths ride through:

- `execution_guidance.must_read_files`
- `runtime_context.task_context_files`
- Goose worker recipe instructions that treat those files as the first queue

**Step 2: Run the focused runtime-context tests**

Run:

```bash
npm run build
node --test tests/runtime-context-builder.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: fail until the docs/tests and recipe wording line up with the new
workflow

**Step 3: Implement the smallest necessary updates**

Prefer docs and recipe-language changes over new runtime fields. Reuse the
existing `must_read_files` -> `task_context_files` flow.

**Step 4: Re-run the focused runtime-context tests**

Run:

```bash
npm run build
node --test tests/runtime-context-builder.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: pass

### Task 4: Validate the full slice, publish it, and open the PR

**Files:**
- Modify: the staged files from Tasks 1-3 only

**Task docs:**
- `docs/goose/pr-workflow.md`
- `docs/plans/2026-04-01-goose-plan-linked-docs-design.md`
- `docs/plans/2026-04-01-goose-plan-linked-docs.md`

**Step 1: Run the narrowest useful validation first**

Run:

```bash
git diff --check
npm run build
node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs tests/runtime-context-builder.test.mjs tests/openclaw-runtime-adapter.test.mjs tests/orchestrator-goose-runtime.test.mjs
```

Expected: pass

**Step 2: Run broader repo validation**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: pass

**Step 3: Commit and publish**

Run:

```bash
git add <changed files>
git commit -m "feat: add goose plan-linked docs workflow"
git push --set-upstream origin codex/goose-plan-linked-docs
```

**Step 4: Open the review PR**

Create a PR against `main` and stop after it is ready for review. Do not merge.
