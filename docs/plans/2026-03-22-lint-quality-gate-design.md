# Lint Quality Gate Design

**Date:** 2026-03-22

## Background

The repository already treats `test-agent` and `review-agent` as post-implementation quality gates, not planned task owners. The GitHub Actions surface currently runs typecheck/build and repository tests, but there is no first-class lint workflow and there are no repository-local lint commands in `package.json`.

That creates a gap between:
- CI quality signals, where the repository should be able to fail fast on style and static-analysis issues
- local developer and agent workflows, where the same checks should be runnable without depending on a GitHub-hosted action
- future `test-agent` execution, where lint should be representable as part of the smallest reliable verification scope without introducing a new top-level quality role

## Goal

Add a repository-standard lint path that:
- introduces local lint configuration and `npm` scripts for the current TypeScript/JavaScript, Markdown, YAML, and GitHub Actions footprint
- introduces a dedicated `CI Lint` workflow using `super-linter`
- documents that future `test-agent` integration should call repository-local lint commands rather than the GitHub Action container directly

## Non-goals

- do not add a new top-level quality role such as `lint-agent`
- do not redesign the `QualityGateRunner` public contract in this change
- do not make `test-agent` execute real lint commands yet
- do not sweep the whole repository into broad formatting churn unrelated to lint enablement
- do not replace the existing `CI Tests` workflow

## Constraints

- keep `test-agent` and `review-agent` as the only quality-gate roles
- keep quality gates external to implementation ownership
- keep the lint configuration recoverable and runnable both locally and in CI
- prefer a narrow initial rule set that matches the repository's current languages and files
- keep local and CI rules aligned enough that future agent execution can reuse the same repository contracts

## Planning / Runtime Contract Check

Current contracts and docs already constrain the right shape:
- `test-agent` and `review-agent` are the only worker quality roles today.
- `QualityGateRunner` only returns `test_status` and `review_status`, so adding lint as a separate runtime role would widen current contracts.
- `test-agent` is already defined as running the smallest reliable verification scope, which can include lint checks when appropriate.
- existing tests already recognize a `CI Lint` check name in plan-runner coverage, so a dedicated lint workflow aligns with checked-in expectations.

This change therefore aligns the repository with current architecture instead of extending role ownership.

## Options

### Option 1: CI-only `super-linter`

Add only a GitHub Actions workflow that runs `super-linter`.

Pros:
- smallest implementation
- immediate PR signal

Cons:
- no repository-local lint command for developers or agents
- future `test-agent` integration would need a second implementation path

### Option 2: `super-linter` for CI plus repository-local lint commands

Add `super-linter` as a CI wrapper, and add local lint configurations plus `npm` scripts that the repository can run directly.

Pros:
- CI and future agent execution share the same lint intent
- keeps GitHub Action usage at the workflow boundary
- avoids coupling the runtime quality gate seam to a GitHub-specific container action

Cons:
- slightly larger initial change
- requires selecting and wiring a small set of local lint tools

### Option 3: add a separate `lint-agent`

Introduce a new quality role and runtime status handling for lint.

Pros:
- more explicit quality separation

Cons:
- widens worker role contracts and prompt surfaces
- unnecessary for the current MVP priorities
- higher risk of muddying quality-gate ownership semantics

## Recommendation

Use Option 2.

This repository should treat `super-linter` as a CI integration surface, not as the only lint implementation. Repository-local lint commands keep the quality loop explainable, testable, and reusable by future `test-agent` execution without changing quality-gate ownership.

## Final Design

### 1. Add repository-local lint tooling

Add a small local lint stack:
- ESLint for `.ts`, `.js`, and `.mjs`
- markdownlint for Markdown
- yamllint for YAML and GitHub Actions workflows

Expose these via `package.json` scripts such as:
- `lint`
- `lint:js`
- `lint:md`
- `lint:yml`

Use a narrow, repository-friendly initial rule set so the first adoption phase remains correct and reviewable.

### 2. Add a dedicated `CI Lint` workflow using `super-linter`

Create a new workflow that:
- runs on pull requests
- checks out full git history
- uses `super-linter/super-linter`
- validates only the repository-relevant languages
- starts with `VALIDATE_ALL_CODEBASE=false` so the initial rollout focuses on changed files

This keeps CI ergonomics and job reporting benefits from `super-linter` without making it the only runnable lint surface.

### 3. Keep runtime ownership unchanged

Do not add new quality roles or schema fields in this change.

Instead, document that future `test-agent` integration should:
- invoke repository-local lint commands
- record lint execution in existing `commands_run` / `test_results` evidence
- keep lint under the existing `test-agent` verification umbrella

### 4. Update docs alongside the code

Update repository documentation so contributors can find:
- the new local lint commands
- the new CI lint workflow
- the rule that `test-agent` should reuse local lint commands rather than directly invoking the GitHub Action container

## Acceptance Criteria

- [ ] local lint commands exist and run against the current repository languages
- [ ] a dedicated `CI Lint` workflow exists and uses `super-linter`
- [ ] docs explain how lint works locally and in CI
- [ ] docs explain the intended future `test-agent` integration path without changing current runtime ownership
- [ ] validation results are recorded clearly

## Affected Modules

- `package.json`
- `.github/workflows/`
- root lint config files
- `README.md`
- `ARCHITECTURE.md` or adjacent design docs if the quality-gate guidance needs clarification
- targeted tests that lock CI check expectations

## Risks

- ESLint flat-config setup for mixed `.ts` and `.mjs` files may need careful parser wiring
- `super-linter` can become noisy if too many validators are enabled up front
- Markdown/YAML defaults may flag existing repository content, so the initial rules must stay intentionally narrow
- documenting future `test-agent` lint use without implementing it yet must remain explicit to avoid implying runtime behavior that does not yet exist

## Validation Steps

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- focused tests covering any changed workflow/check expectations
- `git diff --check`
