# Planning Pipeline MVP Design

Date: 2026-03-15

## Scope

Implement PR2 by turning the current planning skeleton into a typed pipeline that:
- resolves planning mode for `auto`, `direct`, and `debate`
- supports a direct planning flow
- supports a debate flow across `architecture-planner`, `engineering-planner`, and `integration-planner`
- synthesizes debate outputs into one validated `planning result`
- converts that result into the existing execution DAG

## Existing Baseline

The repository already contains:
- a `PlanningController` with basic planning-mode heuristics and planner model selection
- a `validatePlanningResult` function and DAG builder
- runtime orchestration, retries, quality gates, reporting, and a direct fixture/demo

The missing layer is the planning pipeline itself: there is no typed contract for direct planners or debate analyzers, no synthesis step, and no runnable plan-generation path from request to DAG.

## Options Considered

### Option A: Expand `planning-controller.ts`

Keep all mode resolution, role routing, direct planning, debate fan-out, synthesis, and normalization in one file.

Why not:
- mixes orchestration and domain logic
- weakens test boundaries
- makes later adapter swaps harder

### Option B: Add a separate planning pipeline service

Keep `PlanningController` thin and move pipeline behavior into explicit modules:
- mode resolver
- contracts
- normalizer
- pipeline service
- mock planners/analyzers
- debate synthesizer

Why this is the best fit:
- matches the repository’s layered architecture
- gives clean units for targeted tests
- keeps the PR2 mock implementation coherent without overcommitting to PR3/PR4 adapters

### Option C: Skip pipeline modules and hardcode fixtures in the demo

Why not:
- does not satisfy the request for a coherent, typed, testable pipeline
- produces a demo but not a reusable planning subsystem

## Selected Design

Use Option B.

### Planning Contracts

Add explicit planning-layer contracts for:
- requested vs resolved planning mode
- planner role routing metadata
- direct planner inputs/outputs
- debate analyzer inputs/outputs
- synthesis inputs/outputs

The final `planning result` stays implementation-only. Quality roles remain outside task ownership.

### Pipeline Shape

`PlanningPipeline.createPlan(request)` will:
1. resolve planning mode
2. route models for the planning roles with the existing explicit role-based fallback router
3. run either:
   - direct planner -> planning draft
   - three debate analyzers in parallel -> synthesized planning draft
4. normalize the draft into a final `planning result`
5. validate the result
6. return the validated result for DAG conversion

### Debate Synthesis

Each debate analyzer returns a structured perspective with:
- role
- summary
- recommended plan fragment
- implementation task proposals
- notes and risks

The synthesizer merges compatible task proposals by task id, unions acceptance criteria/dependencies, escalates complexity and risk conservatively, and deduplicates notes/risks. Conflicting ownership outside the allowed implementation roles is rejected.

### Fixtures and Demo

Add:
- one direct planning request/result fixture
- one debate planning request/result fixture
- a runnable demo that shows request -> planning result -> execution DAG

### Testing

Add tests for:
- planning mode resolution
- direct planning pipeline behavior
- debate planning pipeline behavior and synthesis
- request -> validated result -> DAG conversion path

## Risks and Mitigations

- Risk: synthesis logic becomes too ambitious for an MVP.
  Mitigation: keep the merge rules deterministic and conservative.

- Risk: prompt assets drift from the code contracts.
  Mitigation: rewrite planning prompt files using a shared section structure and reflect the same runtime constraints.

- Risk: tests become brittle if they depend on prompt text.
  Mitigation: test pipeline outputs and routing metadata, not prompt file contents.
