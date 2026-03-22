# Lint Quality Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add repository-local lint commands plus a dedicated `CI Lint` workflow backed by `super-linter`, and document that future `test-agent` lint execution should reuse the local lint commands.

**Architecture:** Keep quality-gate ownership unchanged. This change adds local lint configuration and `package.json` scripts as the canonical execution surface, then layers `super-linter` on top as a GitHub Actions wrapper for PR checks. Future `test-agent` work should call the local commands and record evidence through existing quality-gate contracts instead of introducing a new runtime role.

**Tech Stack:** TypeScript, Node, ESLint flat config, markdownlint-cli, yamllint, GitHub Actions, super-linter

---

### Task 1: Add failing tests that lock the new lint contract

**Files:**
- Modify: `tests/run-plan-doc.test.mjs`
- Modify: `tests/local-codex-review.test.mjs`

**Step 1: Write the failing tests**

Add or update tests so they assert:
- the repository can surface a `CI Lint` check alongside the existing tests workflow expectations
- local review and workflow-facing docs can reference a repository-standard lint command without inventing a new quality role

**Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm run build && node --test tests/run-plan-doc.test.mjs tests/local-codex-review.test.mjs
```

Expected:
- FAIL because the repository does not yet expose the intended lint contract consistently

### Task 2: Add repository-local lint configuration and scripts

**Files:**
- Create: `eslint.config.mjs`
- Create: `.markdown-lint.yml`
- Create: `.yaml-lint.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add the minimal local lint dependencies**

Install only the packages required for the initial repository footprint:
- ESLint and the TypeScript ESLint packages for `.ts`, `.js`, and `.mjs`
- markdownlint CLI for Markdown

Keep the dependency set intentionally small and aligned with current repository files.

**Step 2: Add the failing local command check**

Run:

```bash
npm run lint
```

Expected:
- FAIL because the new config files or scripts are not fully wired yet

**Step 3: Write the minimal lint configuration**

Implement:
- an ESLint flat config that supports TypeScript source and `.mjs` scripts/tests
- Markdown rules tuned narrowly enough for the existing docs footprint
- Yamllint rules for workflows and repository YAML files
- `package.json` scripts for `lint`, `lint:js`, `lint:md`, and `lint:yml`

**Step 4: Run the local lint commands to verify they pass**

Run:

```bash
npm run lint
```

Expected:
- PASS

### Task 3: Add the dedicated `CI Lint` workflow

**Files:**
- Create: `.github/workflows/ci-lint.yml`

**Step 1: Add the workflow in failing form**

Create the workflow with:
- pull-request trigger
- full-history checkout
- `super-linter/super-linter`

Intentionally leave the validator scope incomplete or unaligned first so the repository expectation remains clearly test-driven.

**Step 2: Sanity-check the workflow shape**

Run:

```bash
npm run lint:yml
```

Expected:
- FAIL if the workflow YAML or lint rules are still incorrect

**Step 3: Write the minimal correct workflow**

Configure:
- `name: CI Lint`
- `actions/checkout` with `fetch-depth: 0`
- `super-linter` pinned to a current v8 release
- `GITHUB_TOKEN`
- `VALIDATE_ALL_CODEBASE=false`
- only the validators needed for this repository footprint

**Step 4: Re-run the YAML lint check**

Run:

```bash
npm run lint:yml
```

Expected:
- PASS

### Task 4: Document the local and CI lint contract

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md`

**Step 1: Update contributor-facing docs**

Document:
- the new local lint commands
- the new `CI Lint` workflow
- how lint fits into the repository validation sequence

**Step 2: Update architecture guidance**

Clarify that:
- `test-agent` remains the verification owner for future lint execution
- future lint integration should call repository-local commands
- `super-linter` is a CI wrapper, not the runtime quality-gate implementation

**Step 3: Run doc-sensitive checks**

Run:

```bash
npm run lint:md
git diff --check
```

Expected:
- PASS

### Task 5: Run full validation and land the branch

**Files:**
- Verify: `package.json`
- Verify: `.github/workflows/ci-lint.yml`
- Verify: `README.md`
- Verify: `ARCHITECTURE.md`
- Verify: `AGENTS.md`
- Verify: `tests/run-plan-doc.test.mjs`
- Verify: `tests/local-codex-review.test.mjs`

**Step 1: Run the focused and repository checks**

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:runtime
npm run build && node --test tests/run-plan-doc.test.mjs tests/local-codex-review.test.mjs
git diff --check
```

Expected:
- PASS

**Step 2: Commit the change**

Run:

```bash
git add package.json package-lock.json eslint.config.mjs .markdown-lint.yml .yaml-lint.yml .github/workflows/ci-lint.yml README.md ARCHITECTURE.md AGENTS.md tests/run-plan-doc.test.mjs tests/local-codex-review.test.mjs docs/plans/2026-03-22-lint-quality-gate-design.md docs/plans/2026-03-22-lint-quality-gate.md
git commit -m "feat: add lint quality gate foundation"
```

Expected:
- commit created successfully

**Step 3: Push and open the PR**

Run:

```bash
git push -u origin codex/add-super-linter-quality-gate
gh pr create --fill
```

Expected:
- branch exists on remote
- PR URL is returned
