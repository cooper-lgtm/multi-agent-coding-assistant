# Architecture Overview

This project implements a layered orchestrator system on top of OpenClaw.

## Layers

1. **Entry / Request Classification**
   - receives a user request
   - decides whether to answer directly or start formal planning

2. **Planning Layer**
   - supports `auto`, `direct`, and `debate`
   - resolves `auto` into a concrete planning mode before execution
   - runs through a dedicated `PlanningPipeline`
   - debate mode fans out to:
     - `architecture-planner`
     - `engineering-planner`
     - `integration-planner`
   - synthesizes debate outputs into one normalized `planning result`

3. **Execution Graph Layer**
   - validates planning output
   - converts tasks and dependencies into an execution DAG
   - attaches quality-gate configuration
   - initializes runtime state

4. **Dispatch Layer**
   - finds ready implementation tasks
   - routes them to `frontend-agent` or `backend-agent`
   - chooses models via fallback-aware router

5. **Quality Gate Layer**
   - runs `test-agent`
   - then runs `review-agent`
   - returns `completed` or `needs_fix`

6. **Recovery / Reporting Layer**
   - retries execution
   - escalates model selection
   - reports milestones and final summary to the user

## Model Fallback Principle

Every role has a preferred model order. If the first preferred model is unavailable, the router falls back to the next one. Because the user's main model is GPT-5.4, GPT-5.4 is always present as a guaranteed fallback before other final alternatives when configured.

## Planning Pipeline Modules

- `PlanningController`: thin facade for mode resolution, planner model inspection, and `createPlan()`
- `PlanningPipeline`: orchestrates direct planning or debate planning from request to validated result
- `DefaultPlanningModeResolver`: resolves `auto` mode with explicit debate gating
- `MockDirectPlanner`: deterministic direct planner for the MVP
- `MockDebateAnalyzer`: deterministic role analyzers for architecture, engineering, and integration
- `DefaultDebateSynthesizer`: merges debate analyses into one planning draft
- `DefaultPlanningNormalizer`: normalizes drafts, derives trace metadata, and prepares validation-safe output
