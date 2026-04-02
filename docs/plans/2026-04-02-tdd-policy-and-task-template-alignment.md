# TDD Policy And Task Template Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote TDD to a repository-level rule and upgrade the task template into an execution-ready implementation plan format without losing this repo's planning/runtime contract checks.

**Architecture:** The change stays in repository guidance docs. `AGENTS.md` becomes the canonical home for the TDD policy and task-plan authoring guidance, `docs/templates/task-template.md` becomes the execution-ready plan template for future work, and `docs/reviews/recurring-issues.md` captures test-first drift as a repeatable review failure. No runtime code, schemas, or prompts change.

**Tech Stack:** Markdown, repository workflow docs

---

## Background

Two reference PRs in a sibling repository showed a useful split of responsibilities:
- keep TDD doctrine as a stable repository rule instead of restating it in every plan
- keep task templates concise but execution-ready by naming files, first failing tests, implementation notes, and validation

This repository already treats docs as part of the product surface, but its current task template is still mostly a framing checklist. It does not yet steer authors toward compact execution blocks or task-specific test-first targets.

## Goal

Adopt the same repo-level discipline and execution-ready plan shape while preserving this repository's Harness-specific planning/runtime contract checks.

## Non-goals

- rewriting historical plan documents to the new template
- changing runtime behavior, schemas, or tests
- adding a separate contributor rules file such as `CLAUDE.md`

## Constraints

- `AGENTS.md` remains the primary contributor workflow document
- `docs/templates/task-template.md` must keep repository-specific planning/runtime contract checks
- the template should avoid duplicating repo-wide doctrine that belongs in `AGENTS.md`
- this is a doc-only change, so validation can stay lightweight

## Planning / Runtime Contract Check

- Current schemas and runtime modules are unaffected because this task changes only contributor guidance docs.
- Existing tests do not need updates because no code or contract behavior changes.
- The current docs already establish `AGENTS.md` as the workflow source of truth for contributors.
- The template change must preserve visibility into planning/runtime boundaries so future architecture-sensitive tasks still check schemas, tests, and adapter coupling before broad edits.

## Acceptance Criteria

- [ ] `AGENTS.md` states a repository-level TDD policy plus narrow exceptions
- [ ] `AGENTS.md` clarifies how multi-step plans should stay concise and task-specific
- [ ] `docs/templates/task-template.md` becomes an execution-ready implementation plan template
- [ ] the template retains a `Planning / Runtime Contract Check` section
- [ ] `docs/reviews/recurring-issues.md` records test-first drift as a recurring issue
- [ ] validation results are recorded clearly

## Affected Modules

- Modify: `AGENTS.md`
- Modify: `docs/templates/task-template.md`
- Modify: `docs/reviews/recurring-issues.md`
- Create: `docs/plans/2026-04-02-tdd-policy-and-task-template-alignment.md`

## Validation Plan

- `git diff --check`
- `git status --short`

## Deliverables

- updated repository workflow guidance
- updated execution-ready task template
- recurring-issue documentation for TDD drift
- validation notes

## Task Breakdown

### Task 1: Add repository-level TDD policy guidance

**Files:**
- Modify: `AGENTS.md`

**Test First:**
- Doc-only change with no behavior change; no failing automated test is required.

**Implementation Notes:**
- place the TDD policy in the main contributor workflow doc instead of duplicating it across plans
- include explicit exceptions for doc-only and similar non-behavioral work
- clarify that task plans should name task-specific first failing tests and commands instead of restating the full doctrine

**Validation:**
- `git diff --check`

### Task 2: Upgrade the task template to an execution-ready implementation plan

**Files:**
- Modify: `docs/templates/task-template.md`

**Test First:**
- Doc-only change with no behavior change; no failing automated test is required.

**Implementation Notes:**
- preserve `Planning / Runtime Contract Check`
- add a compact `Task Breakdown` format with files, `Test First`, implementation notes, and validation
- add guidance for when explicit RED/GREEN sequencing should be expanded

**Validation:**
- `git diff --check`

### Task 3: Capture test-first drift as a recurring review issue

**Files:**
- Modify: `docs/reviews/recurring-issues.md`

**Test First:**
- Doc-only change with no behavior change; no failing automated test is required.

**Implementation Notes:**
- keep the new issue phrased as a repeatable review smell, not a one-off reminder
- point reviewers toward plans, narrow failing tests, and explicit exceptions

**Validation:**
- `git diff --check`
