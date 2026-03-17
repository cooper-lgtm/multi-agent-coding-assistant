# Harness Engineering Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the repository's Harness Engineering documentation foundation with one canonical architecture doc, standard task/review templates, and repo-specific contributor guidance.

**Architecture:** The work adds three root-level collaboration docs, two supporting docs under `docs/`, removes the legacy `docs/architecture.md`, and updates `README.md` so the repository has one clear documentation entrypoint. The content stays grounded in the current TypeScript orchestrator MVP and its existing planning/runtime modules.

**Tech Stack:** Markdown, GitHub PR workflow, TypeScript repository structure

---

### Task 1: Add the approved design record

**Files:**
- Create: `docs/plans/2026-03-17-harness-engineering-foundation-design.md`

**Step 1: Write the design document**

Add the approved design with:
- goal and context
- chosen option: add root docs and remove legacy architecture doc
- content strategy for `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `docs/templates/task-template.md`, and `docs/reviews/recurring-issues.md`
- migration rules and verification approach

**Step 2: Verify the file exists**

Run: `test -f docs/plans/2026-03-17-harness-engineering-foundation-design.md`
Expected: command exits successfully

**Step 3: Commit**

```bash
git add docs/plans/2026-03-17-harness-engineering-foundation-design.md
git commit -m "docs: add harness foundation design"
```

### Task 2: Create root-level harness docs

**Files:**
- Create: `AGENTS.md`
- Create: `PRODUCT.md`
- Create: `ARCHITECTURE.md`
- Reference: `README.md`
- Reference: `src/planning/planning-pipeline.ts`
- Reference: `src/orchestrator/main-orchestrator.ts`
- Reference: `src/schemas/planning.ts`
- Reference: `src/schemas/runtime.ts`

**Step 1: Write the new root docs**

Create repository-specific content that covers:
- project purpose and priorities
- reading order and repo map
- architecture layers and invariants
- planning/runtime/quality-gate boundaries
- validation and PR expectations

**Step 2: Sanity-check terminology**

Confirm the docs consistently use the current repo vocabulary:
- `main-orchestrator`
- `planning-agent`
- `architecture-planner`
- `engineering-planner`
- `integration-planner`
- `frontend-agent`
- `backend-agent`
- `test-agent`
- `review-agent`

**Step 3: Commit**

```bash
git add AGENTS.md PRODUCT.md ARCHITECTURE.md
git commit -m "docs: add harness root documentation"
```

### Task 3: Add workflow support docs

**Files:**
- Create: `docs/templates/task-template.md`
- Create: `docs/reviews/recurring-issues.md`

**Step 1: Write the task template**

Include required sections for non-trivial work:
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

**Step 2: Write recurring review issues**

Document recurring failure patterns specific to this repository:
- planning/runtime drift
- quality-gate ownership confusion
- retry/escalation contract drift
- model metadata drift
- docs lag
- vague task inputs

**Step 3: Commit**

```bash
git add docs/templates/task-template.md docs/reviews/recurring-issues.md
git commit -m "docs: add harness workflow support docs"
```

### Task 4: Remove legacy architecture doc and update references

**Files:**
- Delete: `docs/architecture.md`
- Modify: `README.md`

**Step 1: Update README**

Add or revise a short documentation entrypoint section that points readers to:
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `docs/templates/task-template.md`
- `docs/reviews/recurring-issues.md`

**Step 2: Delete the legacy architecture doc**

Remove `docs/architecture.md` so the repository has one canonical architecture entrypoint.

**Step 3: Check for stale references**

Run: `rg "docs/architecture\\.md|architecture\\.md" README.md docs AGENTS.md PRODUCT.md ARCHITECTURE.md`
Expected: no required references to the deleted file remain

**Step 4: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: replace legacy architecture entrypoint"
```

### Task 5: Verify, publish, and request review

**Files:**
- Modify: repository git state only

**Step 1: Run verification**

Run: `git diff --check`
Expected: no output

Run: `git status --short`
Expected: only intended documentation changes are present before commit, then clean after commit

**Step 2: Push the branch**

```bash
git pull --rebase origin main
git push -u origin codex/harness-engineering-foundation
```

**Step 3: Open the PR**

Create a PR that explains:
- what docs were added
- why the harness foundation is needed now
- that `docs/architecture.md` was replaced by root `ARCHITECTURE.md`
- what verification was run

**Step 4: Trigger review**

Post a PR comment:

```text
@codex review
```
