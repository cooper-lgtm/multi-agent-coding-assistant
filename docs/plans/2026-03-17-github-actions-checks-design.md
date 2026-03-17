# GitHub Actions Checks Design

**Date:** 2026-03-17

## Goal

Add repository-local GitHub Actions support for the two checks the team wants on pull requests:
- `CI Tests`
- `Codex PR Review`

## Context

This repository currently has no `.github/` directory, but it does have stable local validation commands in `package.json`:
- `npm run typecheck`
- `npm run build`
- `npm run test:adapter`
- `npm run test:planning`
- `npm run test:runtime`

The reference repository already uses:
- a pull-request test workflow
- a pull-request review-request workflow that posts `@codex review`

## Options

### Option 1: Copy the two workflows directly

Pros:
- fastest to create
- keeps the same high-level behavior

Cons:
- duplicates setup steps across jobs
- the test workflow is Python-specific and does not match this TypeScript repository

### Option 2: Add workflows plus one reusable composite action

Pros:
- keeps the same two top-level checks
- avoids repeating Node setup and `npm ci`
- makes future CI additions cheaper

Cons:
- one more file to maintain

### Option 3: Collapse everything into one workflow job

Pros:
- smallest file count

Cons:
- loses separate check visibility
- makes failures less obvious in GitHub UI

## Recommendation

Use Option 2.

Keep the user-facing checks aligned with the reference setup, but adapt the implementation to this repository's actual stack and commands.

## Final Design

- Create `.github/actions/run-npm-check/action.yml`
  - installs Node
  - caches npm dependencies
  - runs `npm ci`
  - executes a caller-provided command block
- Create `.github/workflows/ci-tests.yml`
  - runs on pull requests
  - exposes two jobs:
    - `typecheck-build`
    - `tests`
- Create `.github/workflows/codex-pr-review.yml`
  - runs on non-draft pull request open/sync/ready events
  - posts one `@codex review` comment per commit SHA
  - uses `CODEX_REVIEW_TOKEN`
  - skips cleanly when the secret is missing

## Validation

- parse each YAML file locally
- run the same npm commands used by the CI jobs
- run `git diff --check`
