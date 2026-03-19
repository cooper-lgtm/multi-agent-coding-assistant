# Multi-Agent Coding Assistant Product

## 1. Product Goal

The current product goal is:

> turn multi-agent coding orchestration into a stable, inspectable, and recoverable execution kernel for OpenClaw-based development workflows.

Success is not just "a demo runs."
It means:
- requests can be classified into the right planning path
- planning results are normalized and validated before execution
- runtime execution respects dependencies and ownership boundaries
- quality gates can force repair loops without losing context
- retries and model escalation remain explainable

---

## 2. Core Users and Scenarios

## 2.1 Workflow engineers and agent builders
Scenarios:
- define or evolve planning behavior
- add runtime capabilities without breaking orchestration invariants
- integrate OpenClaw-facing adapters and model routing
- inspect retry, blocking, and quality-gate behavior

They care about:
- correctness
- traceability
- explicit contracts
- debuggable runtime transitions

## 2.2 Repository contributors validating architecture ideas
Scenarios:
- prototype planning strategies
- test DAG scheduling and recovery behavior
- verify typed request/result contracts
- document future implementation work

They care about:
- clear repo guidance
- fast local verification
- stable terminology
- predictable scope boundaries

## 2.3 Product-facing operating modes

The repository is moving toward three explicit operating modes:

- `all-plan`: planning only, ending with a stored `planning result`
- `task-run`: execution from an existing `planning result`
- `end-to-end`: planning plus execution in one controlled flow

These modes are product surfaces over the same kernel, not separate architectures.

---

## 3. Current Priorities

### P0: orchestration correctness
- planning mode resolution works
- planning results validate cleanly
- DAG scheduling honors dependencies
- runtime status transitions remain coherent

### P1: recovery and evidence
- `needs_fix`, `blocked`, and `failed` remain distinct
- retry handoff context is preserved
- reporting explains why a run ended where it did

### P2: model and adapter clarity
- logical model routing and exact-model metadata stay aligned
- OpenClaw-facing request/result envelopes remain typed and testable

### P3: future executor readiness
- the MVP stays easy to replace with real planner/worker adapters later

### P4: explicit mode boundaries
- planning-only workflows should be understandable and storable as artifacts
- execution-from-plan workflows should not require a fresh planning conversation
- end-to-end workflows should preserve the planning artifact instead of treating planning as transient

Current work should not trade P0/P1 for speculative breadth.

---

## 4. Non-goals

This stage does not prioritize:
- a production-grade real worker execution engine
- a polished end-user chat or CLI product surface
- long-lived manually registered agent fleets
- broad prompt experimentation without matching contract updates
- speculative abstractions that are not justified by the current MVP

This means:
- first keep the orchestration kernel coherent
- then expand integrations on top of stable contracts

---

## 5. Success Criteria

### Planning
- `auto`, `direct`, and `debate` flows stay explicit and validated
- debate synthesis still produces implementation-only tasks
- planning trace metadata remains understandable

### Runtime
- ready tasks are dependency-safe
- implementation dispatch stays ownership-correct
- quality gates can return `completed`, `needs_fix`, or `failed` without ambiguity

### Recovery
- retries preserve prior evidence
- model escalation remains role-aware
- blocked descendants become visible in reporting

### Engineering velocity
- a new contributor can find the right layer quickly
- architecture assumptions live in docs and tests, not only in chat memory

### Product surfaces
- contributors can tell whether a change belongs to `all-plan`, `task-run`, or `end-to-end`
- future entry points can map to those modes without redefining the architecture

---

## 6. Product Rules

### 6.1 correctness beats convenience
If a simplification would blur planning/runtime boundaries, prefer the more explicit design.

### 6.2 quality gates are evaluators, not owners
`test-agent` and `review-agent` are part of the loop, but they do not own planned tasks.

### 6.3 evidence must survive retries
When work loops back, the next attempt should inherit enough context to be actionable.

### 6.4 exact-model metadata matters
Logical labels are useful, but runtime integrations must still preserve exact model identities where available.

### 6.5 docs are part of the product surface
If the repo cannot explain how it works, it is not stable enough for agent collaboration.

### 6.6 mode boundaries are part of correctness
If planning-only, execution-only, and composed workflows are not distinguishable, operators will make incorrect assumptions about artifacts, approvals, and recovery.

---

## 7. Current Product Risks

1. planning docs or prompts drifting from runtime contracts
2. quality-gate semantics becoming muddled with implementation ownership
3. model alias handling drifting from exact-model routing metadata
4. orchestration behavior evolving faster than repo-local docs and plans
5. product entry surfaces staying implicit even as the kernel grows more capable

These risks mean current work should emphasize convergence, validation, and documentation before expansion.
