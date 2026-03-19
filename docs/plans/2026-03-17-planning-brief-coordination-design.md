# Planning Brief Coordination Design

**Date:** 2026-03-17

## Background

The repository already defines `planning-agent` as the only formal planning entry point and the role that should return one final `planning result`.

At the same time, the current debate implementation does not actually run a coordinator-led planning flow. In `debate` mode the pipeline fans out directly to:
- `architecture-planner`
- `engineering-planner`
- `integration-planner`

and then merges their outputs with a local synthesizer.

That creates two gaps:
- the current runtime shape does not match the prompt contract that says `planning-agent` coordinates and synthesizes debate planning
- superpowers-style brainstorming expects an interactive conversation, but three parallel planning subagents cannot all ask the user clarifying questions without creating duplicated, conflicting dialogue

The same coordination question appears again in review. A future three-party review flow may benefit from multiple reviewer perspectives, but free-form peer-to-peer reviewer conversations would weaken traceability, recovery, and testability.

## Goal

Define a coordinator-led planning and review design where:
- `planning-agent` is the only user-facing planning role
- `planning-agent` runs the interactive brainstorming flow once, freezes a clarified planning brief, and owns final planning synthesis
- downstream planning subagents perform silent analysis from the same frozen brief
- multi-party review can include limited subagent interaction without becoming an unconstrained conversation mesh

## Non-goals

- letting all planning subagents ask the user questions directly
- turning planning subagents into additional global orchestrators
- modeling quality gates as planned task owners
- introducing arbitrary multi-round agent chat transcripts into planning or review
- replacing current retry, blocking, or quality-gate semantics in the same change

## Constraints

- `main-orchestrator` remains the only global controller
- planning outputs implementation tasks only
- `assigned_agent` remains limited to `frontend-agent` and `backend-agent`
- `test-agent` and `review-agent` remain quality gates, not planned owners
- `needs_fix`, `blocked`, and `failed` must keep their distinct runtime meanings
- model routing and exact-model metadata must remain visible in planning and runtime traces
- any new coordination layer must improve recoverability and traceability, not hide them inside prompt text

## Planning / Runtime Contract Check

### Current schemas allow

- `PlanningRequest` carries the raw request, context, constraints, planning mode, and optional existing artifacts
- `PlannerRouteTrace` already supports `planning-agent`, `architecture-planner`, `engineering-planner`, and `integration-planner`
- `DebateAnalyzerInput` and `DebateAnalysis` model silent analyzer-style work better than fully interactive planning roles
- runtime quality gates currently expose one logical `review-agent` result, not a triad of top-level reviewer roles

### Current tests lock

- direct planning uses `planning-agent`
- debate planning currently records only the three analyzer routes in `planning_trace`
- planning outputs remain implementation-only
- runtime quality gates still resolve into one final `completed`, `needs_fix`, or `failed` outcome

### Existing docs define

- `planning-agent` as the only formal planning entry point
- debate planning as a coordinator-led synthesis problem
- quality gates as post-implementation evaluators rather than owners

### Current gap

The prompt-level target state and the code-level debate implementation are misaligned. The design in this document is intended to align the implementation with the existing planning contract rather than introduce a new role model.

## Problem Summary

The repository needs a stable answer to two related questions:

1. How does a superpowers-style brainstorming workflow gather clarifications in a debate planning flow without three subagents all talking to the user?
2. If the system eventually supports three-party review, when should subagents interact with each other and how should those interactions be controlled?

## Options Considered

### Option 1: Keep all three planning subagents fully interactive

Each planning subagent asks the user its own questions, writes its own plan, and a later step tries to merge the results.

Why not:
- duplicates user interaction
- produces conflicting clarifications
- makes retry and resume hard because there is no single frozen planning context
- weakens the existing rule that `planning-agent` is the formal planning entry point

### Option 2: Use one planning coordinator plus silent planning analyzers

`planning-agent` owns all user interaction, freezes a clarified planning brief, and then dispatches the same brief to silent planning analyzers. Those analyzers may ask for more information only by returning structured clarification requests to the coordinator.

Why this is the best fit:
- matches the current prompt contract
- keeps one conversational authority
- preserves traceability because every later analysis points to the same frozen brief
- fits the current code shape, where debate roles already look like analyzers

### Option 3: Collapse debate planning into one planner and remove analyzer roles

Only `planning-agent` plans. The three specialist roles disappear.

Why not:
- loses the multi-perspective value that debate planning was added to provide
- makes architecture, engineering, and integration concerns less inspectable
- does not help with the separate review-coordination problem

## Decision

Use Option 2.

The system should adopt a coordinator-led planning flow and a controlled-review interaction model:
- `planning-agent` is the only role that interacts with the user during planning
- planning subagents are silent analyzers, not separate interactive planners
- planning subagents may critique each other only through one bounded, structured cross-review round when needed
- multi-party review should use the same control pattern: independent analysis first, bounded cross-review second, single coordinator decision last

## Selected Design

### 1. Clarified planning brief

Introduce a frozen planning artifact between user interaction and debate analysis.

`planning-agent` performs the interactive brainstorming flow and produces a `clarified planning brief` that captures:
- normalized request summary
- confirmed goals
- confirmed non-goals
- confirmed constraints
- assumptions accepted by the coordinator
- known risks
- unresolved questions, if any
- whether the brief is ready for direct planning or debate analysis

This brief becomes the shared source of truth for all downstream planners.

### 2. Planning coordination flow

The planning flow should become:

1. `planning-agent` reads the user request and repo context
2. `planning-agent` runs the only user-facing brainstorming conversation
3. `planning-agent` freezes `clarified planning brief v1`
4. debate analyzers run silently from that brief
5. if analyzers detect missing information, they return structured `clarification_requests`
6. `planning-agent` decides whether to:
   - answer from existing context
   - reopen clarification with the user and freeze `clarified planning brief v2`
   - reject the request as under-specified
7. `planning-agent` synthesizes the final `planning result`

This keeps user dialogue centralized while still allowing specialists to surface missing context.

### 3. Silent analyzer responsibilities

The three debate subagents remain useful, but their responsibilities narrow:

#### `architecture-planner`

- boundary analysis
- contract-first sequencing
- coupling and maintainability risk

#### `engineering-planner`

- implementation feasibility
- schema, API, storage, and migration impact
- quality-gate depth recommendations

#### `integration-planner`

- frontend/backend handoff risk
- async, state-transition, and boundary-condition risk
- recovery-path and coordination risk

Each analyzer may return:
- structured task proposals
- notes and risks
- optional clarification requests
- optional critique of peer outputs during a bounded cross-review stage

They do not:
- ask the user questions directly
- produce the final plan
- invoke `writing-plans`
- decide the orchestrator strategy

### 4. Controlled planner cross-review

Planning subagents may interact with each other, but only through a bounded protocol.

Recommended rule:
- default to zero peer interaction for straightforward debate planning
- enable one cross-review round only when there is conflict, high risk, or unresolved sequencing disagreement

In that round, each analyzer receives only:
- the frozen brief
- peer summaries
- peer task proposals
- peer risks

Each analyzer returns a structured critique:
- `agree`
- `disagree`
- `missing_risk`
- `missing_dependency`
- `ownership_concern`
- supporting evidence

They do not exchange free-form multi-turn messages.

### 5. Final planning authority

`planning-agent` should become the real coordinator in debate mode, not only at the prompt level.

That means debate planning should:
- route and record `planning-agent` in the planning trace
- preserve analyzer routes and summaries as inputs to the coordinator
- treat the local synthesizer as coordinator logic or replace it with an explicit `planning-agent` synthesis adapter

Because the repository already prefers Codex for `planning-agent`, this also satisfies the desired product direction that Codex should produce the final plan while still incorporating non-Codex perspectives.

### 6. Review coordination model

Three-party review should follow the same control discipline, but remain inside the quality-gate layer.

Recommended shape:

1. one logical `review-agent` gate remains visible to the orchestrator
2. inside that gate, three reviewer perspectives may run independently
3. reviewers may perform one bounded cross-review round against structured findings only
4. a review coordinator emits the final review decision

This keeps the public runtime contract stable while allowing richer internal review behavior.

### 7. Review decision rules

To preserve correctness over convenience:

- `approved` requires no surviving blocking findings
- `needs_fix` is returned when a blocking finding survives cross-review
- unresolved disagreement on a blocking finding should not auto-approve the change
- unresolved disagreement should escalate to manual review or a conservative `needs_fix`

This prevents three-party review from turning into a hidden consensus game.

## Proposed Contract Changes

### Planning contracts

Add a coordinator artifact and structured clarification pathway:
- add `ClarifiedPlanningBrief` schema
- allow `PlanningRequest` or planning pipeline context to carry a clarified brief artifact
- extend debate analyzer inputs to include the frozen brief
- extend debate analyzer outputs with optional `clarification_requests`
- optionally add bounded `cross_review` summaries to planning trace metadata

### Planning trace

Align debate trace with the actual coordinator-led flow:
- include `planning-agent` route in debate planning traces
- keep analyzer routes and summaries
- record clarified brief version or clarification round count when applicable

### Review contracts

Keep the top-level review gate stable, but enrich internal evidence:
- keep one logical `review-agent` result for the orchestrator
- add structured internal reviewer findings rather than only plain strings when triad review is enabled
- preserve a human-readable `review_feedback` summary for retry handoff

## Affected Modules

Likely implementation touch points:
- `src/schemas/planning.ts`
- `src/planning/contracts.ts`
- `src/planning/planning-pipeline.ts`
- `src/planning/debate-synthesizer.ts`
- `src/planning/planning-normalizer.ts`
- `src/adapters/model-router.ts`
- `src/orchestrator/quality-gate-runner.ts`
- `src/workers/contracts.ts`
- `prompts/planning-agent.system.md`
- `prompts/planning-agent.debate.md`
- `prompts/architecture-planner.md`
- `prompts/engineering-planner.md`
- `prompts/integration-planner.md`
- `prompts/review-agent.md`
- planning and runtime tests that lock current route traces and review outputs

## Risks

### Risk 1: Coordinator logic becomes too implicit

If the code keeps a local synthesizer but starts describing it as a real coordinator, the same prompt/runtime drift will return.

Mitigation:
- make coordinator responsibilities explicit in code contracts and traces

### Risk 2: Cross-review expands into uncontrolled debate

If peer review is modeled as arbitrary back-and-forth, reproducibility and testing will degrade quickly.

Mitigation:
- hard-cap the number of cross-review rounds at one by default
- exchange structured findings, not open transcripts

### Risk 3: Review coordination blurs ownership

If reviewer subagents gain authority similar to implementation owners, quality-gate semantics will drift.

Mitigation:
- keep triad review inside the logical `review-agent` quality gate
- keep `needs_fix` routing targeted back to the implementation owner

### Risk 4: Codex coordination reduces reviewer independence

Using Codex as the final planning coordinator is desirable, but using the same coordinator pattern for review may reduce independence if the implementation path is also Codex-heavy.

Mitigation:
- make review coordination configurable and keep manual review escalation available for contested blocking findings

## Acceptance Criteria

- [ ] planning uses one user-facing coordinator role
- [ ] debate analyzers can consume a frozen clarified brief without directly asking the user questions
- [ ] debate traces record the coordinator role and analyzer evidence coherently
- [ ] bounded cross-review rules are explicit for planning and review
- [ ] three-party review remains a quality-gate concern, not a planning-owner concern
- [ ] retry handoff still preserves actionable review feedback after coordination
- [ ] docs, prompts, schemas, and tests can be updated without hidden contract drift

## Validation Steps

For this design-only change:
- `git diff --check`

For the later implementation:
- focused planning pipeline tests
- focused runtime quality-gate tests
- `npm run typecheck`
- `npm run build`

## Deliverables

- this design document as the repo-local source of truth for the coordinator-led planning flow
- a documented answer to how planning brainstorming and future three-party review should coordinate
