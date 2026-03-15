# Multi-Agent Coding Assistant Delivery Roadmap

**Date:** 2026-03-15
**Purpose:** checkpoint the implementation roadmap inside the repository so later sessions can recover the planned delivery sequence even if chat context is truncated.

## Roadmap Principles

1. Build the system as an orchestrator product, not as a loose pile of standalone agents.
2. Keep `planning result` focused on implementation tasks only.
3. Keep `test-agent` and `review-agent` as post-implementation quality gates.
4. Prefer thin, composable modules over one giant controller file.
5. Keep prompt assets in English and treat them as first-class runtime artifacts.
6. Add runnable demos and regression tests in every meaningful PR.

## Status Snapshot

### PR1 — Runtime loop and demo
**Status:** merged

Delivered:
- implementation dispatcher
- quality gate runner
- retry / escalation manager
- reporting manager
- runnable orchestration demo
- runtime regression tests

This PR established the execution kernel that later planning and adapter work will plug into.

---

## Planned PR Sequence

### PR2 — Planning pipeline MVP
**Theme:** turn planning from static documents into executable code paths.

**Why this PR exists**
The runtime loop now exists, but the system still lacks a real planning subsystem that can generate structured `planning result` artifacts through `auto`, `direct`, and `debate` modes.

**Primary scope**
- harden planning result schema and normalization
- implement planning controller flow for `auto`, `direct`, and `debate`
- add planner role contracts for:
  - `planning-agent`
  - `architecture-planner`
  - `engineering-planner`
  - `integration-planner`
- introduce prompt asset loading / registry structure
- keep prompts in English and align prompt structure with prompt-builder style
- add planning fixtures and a planning demo
- add tests for planning-mode resolution and planning-result validation / synthesis

**Expected outcome**
A request can be transformed into a validated `planning result`, then into an execution DAG, even if the planner implementations are still mock/demo adapters.

---

### PR3 — OpenClaw runtime adapter layer
**Theme:** connect the orchestrator contracts to real OpenClaw messaging/session primitives.

**Primary scope**
- add OpenClaw session adapter abstractions
- wire planning roles and worker roles through OpenClaw-compatible adapters
- expose model-availability probing / routing helpers
- standardize task payloads, result envelopes, and error envelopes
- add adapter-focused demos or fixtures

**Expected outcome**
The orchestrator no longer only runs on in-process mocks; it can drive role execution through OpenClaw-facing integration contracts.

---

### PR4 — Worker execution bridge MVP
**Theme:** make implementation worker execution realistic instead of purely mocked.

**Primary scope**
- implement worker prompt assembly for frontend/backend/test/review roles
- define execution payload format for coding workers
- capture changed files, summaries, blocker reports, and quality-gate evidence
- support retry handoff context so a retried task receives prior failure feedback
- add end-to-end sample flow on a small example repo or fixture

**Expected outcome**
The runtime loop can execute a believable worker workflow instead of only deterministic mocks.

---

### PR5 — Persistence, resume, and operational state
**Theme:** make runs durable and recoverable.

**Primary scope**
- file-backed run store
- event log / run manifest format under `state/`
- resume / reload support for interrupted runs
- cancellation / pause primitives
- run inspection helpers for debugging and postmortem analysis

**Expected outcome**
A run becomes an inspectable artifact rather than a purely in-memory process.

---

### PR6 — Human approval and orchestration controls
**Theme:** add controlled checkpoints between planning and execution.

**Primary scope**
- plan review / approval gates
- optional auto-execute vs confirm-before-run mode
- user-facing progress summary formatting
- explicit escalation paths for blocked or repeated-failure tasks
- approval-state representation in runtime data structures

**Expected outcome**
The system supports a practical human-in-the-loop workflow instead of assuming everything always auto-runs.

---

### PR7 — Budget, policy, and safety controls
**Theme:** make orchestration behavior configurable and safer under real usage.

**Primary scope**
- budget-policy expansion beyond retry count
- max parallelism enforcement
- model fallback policy configuration by role
- task risk thresholds and escalation policy tuning
- guardrails for expensive or high-risk execution paths

**Expected outcome**
The orchestrator can be tuned for cost, speed, and risk tolerance without rewriting control logic.

---

### PR8 — Evaluation suite and golden scenarios
**Theme:** verify the system against realistic multi-step scenarios.

**Primary scope**
- golden planning-result fixtures
- end-to-end orchestrator scenarios
- negative-path tests for blocked / needs-fix / failed branches
- sample repositories or compact scenario fixtures
- evaluation notes documenting known limitations

**Expected outcome**
The project gains a meaningful regression harness for future refactors.

---

### PR9 — CLI and productized entry points
**Theme:** expose the system through stable user entry surfaces.

**Primary scope**
- local CLI entry points such as plan / run
- repo path and planning mode flags
- structured output options for automation
- packaging polish and onboarding docs

**Expected outcome**
The project becomes usable outside direct code-level invocation.

---

## Notes on sequencing

This roadmap is intentionally incremental.

- PR1 built the execution kernel first.
- PR2 should build the planning subsystem next.
- PR3 and PR4 then connect planning/runtime contracts to real role execution.
- PR5 onward shifts toward durability, control, safety, and productization.

The exact file list may evolve inside each PR, but the architectural direction should remain stable unless a later design review explicitly changes it.
