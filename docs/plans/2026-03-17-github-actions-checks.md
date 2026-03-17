# GitHub Actions Checks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reusable GitHub Actions support for `CI Tests` and `Codex PR Review` in this repository.

**Architecture:** Keep the two top-level pull request checks from the reference repository, but adapt the implementation to this TypeScript project. Use one composite action to centralize Node setup and dependency installation, then call it from the CI workflow jobs.

**Tech Stack:** GitHub Actions YAML, composite actions, npm, TypeScript

---

### Task 1: Add the reusable npm check action

**Files:**
- Create: `.github/actions/run-npm-check/action.yml`

**Step 1: Add the composite action definition**

Create a composite action that:
- accepts `node-version`
- accepts a multi-line `command`
- uses `actions/setup-node@v4` with npm caching
- runs `npm ci`
- runs the provided command block with `bash`

**Step 2: Parse the action YAML**

Run:

```bash
ruby -e "require 'yaml'; YAML.load_file('.github/actions/run-npm-check/action.yml')"
```

Expected:
- command exits successfully

### Task 2: Add the CI workflow

**Files:**
- Create: `.github/workflows/ci-tests.yml`

**Step 1: Add the pull request workflow**

Define one workflow named `CI Tests` with two jobs:
- `typecheck-build`
- `tests`

Both jobs should:
- check out the repository
- call the composite action

The commands should be:

```bash
npm run typecheck
npm run build
```

and:

```bash
npm run test:adapter
npm run test:planning
npm run test:runtime
```

**Step 2: Parse the workflow YAML**

Run:

```bash
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci-tests.yml')"
```

Expected:
- command exits successfully

### Task 3: Add the Codex PR review workflow

**Files:**
- Create: `.github/workflows/codex-pr-review.yml`

**Step 1: Add the review-request workflow**

Define one workflow named `Codex PR Review` that:
- runs on pull request open, reopen, synchronize, and ready-for-review events
- ignores draft pull requests
- supports local `ACT` dry runs
- posts `@codex review` once per head commit SHA
- uses `secrets.CODEX_REVIEW_TOKEN`
- skips cleanly if the secret is not configured

**Step 2: Parse the workflow YAML**

Run:

```bash
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/codex-pr-review.yml')"
```

Expected:
- command exits successfully

### Task 4: Run repository validation

**Files:**
- Verify: `package.json`
- Verify: `.github/actions/run-npm-check/action.yml`
- Verify: `.github/workflows/ci-tests.yml`
- Verify: `.github/workflows/codex-pr-review.yml`

**Step 1: Run the same checks the workflow depends on**

Run:

```bash
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
```

Expected:
- all commands exit successfully

**Step 2: Run diff hygiene validation**

Run:

```bash
git diff --check
```

Expected:
- no whitespace or patch formatting errors
