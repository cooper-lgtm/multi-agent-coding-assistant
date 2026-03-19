# Plan Runner Script Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a testable repository-local plan runner that executes task-sized goose PR loops and proves the check/review/merge control flow with deterministic tests.

**Architecture:** Keep the operator entrypoint as a thin script, move the control-flow logic into a small injectable automation module, and validate behavior through both in-memory runner tests and fake-binary script integration tests. Treat Codex review request workflow success as distinct from review completion on the current PR head SHA.

**Tech Stack:** TypeScript, Node test runner, existing goose recipes, GitHub CLI command contracts, deterministic fake command runners

---

### Task 1: Add the plan-runner logic module with failing state-machine tests

**Files:**
- Create: `src/automation/plan-runner.ts`
- Modify: `src/index.ts`
- Test: `tests/plan-runner.test.mjs`

**Step 1: Write the failing tests**

Add focused tests for these behaviors:
- waits for required checks before merge
- ignores Codex review workflow success until a bot review exists for the current head SHA
- requests a repair loop when the current head SHA has inline findings
- merges and continues when the current head SHA has no findings

Use an injected fake command runner instead of real subprocesses.

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/plan-runner.test.mjs`
Expected: FAIL because no automation module or exported plan-runner behavior exists yet.

**Step 3: Write minimal implementation**

Implement the smallest injectable module that:
- accepts ordered task hints
- invokes goose once per task
- polls injected check/review helpers
- returns structured per-task outcomes

Keep real shell execution out of this module.

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/plan-runner.test.mjs`
Expected: PASS for the initial state-machine scenarios.

**Step 5: Commit**

```bash
git add src/automation/plan-runner.ts src/index.ts tests/plan-runner.test.mjs
git commit -m "feat: add testable plan runner logic"
```

### Task 2: Add the executable script and fake-binary integration harness

**Files:**
- Create: `scripts/run-plan-doc.mjs`
- Create: `tests/run-plan-doc.test.mjs`
- Create: `tests/fixtures/fake-bin/gh`
- Create: `tests/fixtures/fake-bin/goose`

**Step 1: Write the failing integration test**

Add a script test that:
- executes `scripts/run-plan-doc.mjs`
- prepends fake `gh` and fake `goose` binaries to `PATH`
- drives one task through create PR -> checks pending -> checks pass -> review delayed -> review clean -> merge

Assert that the script exits successfully and records the expected command sequence.

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/run-plan-doc.test.mjs`
Expected: FAIL because the script and fake-bin harness do not exist yet.

**Step 3: Write minimal implementation**

Add:
- the thin script wrapper
- fake `gh` and fake `goose` fixtures that read/write deterministic state files
- enough shell wiring for the script to call the automation module with real subprocess adapters

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/run-plan-doc.test.mjs`
Expected: PASS with the deterministic fake-binary harness.

**Step 5: Commit**

```bash
git add scripts/run-plan-doc.mjs tests/run-plan-doc.test.mjs tests/fixtures/fake-bin/gh tests/fixtures/fake-bin/goose
git commit -m "test: add plan runner script harness"
```

### Task 3: Cover the repair loop and document validation scope

**Files:**
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `docs/goose/pr-workflow.md`
- Modify: `README.md`

**Step 1: Write the failing test**

Add a second script integration scenario where:
- the first review for the current head SHA returns inline findings
- goose performs a repair push
- checks rerun and pass
- a later review for the new head SHA returns clean
- merge happens only after the clean review

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/run-plan-doc.test.mjs`
Expected: FAIL because the first script version does not yet support the repair loop fully.

**Step 3: Write minimal implementation**

Update the automation logic and script wiring so the repair loop:
- detects findings tied to the current head SHA
- reruns goose on the same task
- waits again for checks and review on the new head SHA

Document that:
- the script proves workflow control logic
- repository tests and human/review signals still validate code correctness

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/run-plan-doc.test.mjs`
Expected: PASS for both clean and repair-loop scenarios.

**Step 5: Commit**

```bash
git add tests/run-plan-doc.test.mjs docs/goose/pr-workflow.md README.md
git commit -m "feat: add repair-loop coverage for plan runner"
```

### Task 4: Run focused verification and record remaining risks

**Files:**
- Modify: `docs/evals/known-limitations.md`

**Step 1: Run focused verification**

Run: `npm run build`
Expected: PASS

Run: `node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs`
Expected: PASS

Run: `node --test tests/cli-smoke.test.mjs tests/goose-recipe-builder.test.mjs`
Expected: PASS

Run: `git diff --check`
Expected: no output

**Step 2: Write minimal doc update**

Record that:
- the plan-runner tests validate automation flow correctness with deterministic stubs
- live GitHub/goose behavior still requires occasional smoke validation

**Step 3: Re-run doc verification**

Run: `git diff --check`
Expected: no output

**Step 4: Commit**

```bash
git add docs/evals/known-limitations.md
git commit -m "docs: record plan runner validation scope"
```
