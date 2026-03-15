# OpenClaw Runtime Adapter Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a typed OpenClaw-facing adapter layer for planning and worker roles, including model alias resolution, standardized execution envelopes, adapter fixtures/demo, and regression tests without building the full worker execution bridge.

**Architecture:** Keep the current orchestrator loop and planning pipeline intact, then add a composable adapter seam beside them. Introduce typed request/result/error envelopes plus an OpenClaw model resolver that can map logical aliases like `claude` and `gemini` to exact OpenClaw model ids while preserving compatibility metadata for existing runtime records.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing planning/runtime modules, mock/demo adapters

---

### Task 1: Add failing adapter tests

**Files:**
- Create: `tests/openclaw-runtime-adapter.test.mjs`
- Create: `tests/openclaw-model-resolution.test.mjs`

**Step 1: Write the failing tests**

Assert:
- planning role requests produce standardized payload envelopes
- worker role requests produce standardized payload envelopes
- model resolution preserves logical aliases and resolves exact ids
- exact ids are preserved when already provided

**Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/openclaw-runtime-adapter.test.mjs tests/openclaw-model-resolution.test.mjs`
Expected: FAIL because the new adapter exports and behavior do not exist yet.

### Task 2: Add OpenClaw adapter contracts and resolver

**Files:**
- Create: `src/adapters/openclaw-runtime-adapter.ts`
- Create: `src/adapters/openclaw-model-resolver.ts`
- Create: `src/examples/openclaw-adapter-fixtures.ts`
- Modify: `src/index.ts`
- Modify: `src/adapters/model-router.ts`

**Step 1: Add typed role envelope contracts**

Define:
- planning roles vs worker roles
- request envelopes
- result envelopes
- error envelopes
- model resolution metadata
- a mockable/stub OpenClaw runtime adapter interface

**Step 2: Add model alias resolution**

Support:
- `openai-codex/gpt-5.4`
- `anthropic/claude-opus-4-6`
- `google-gemini-cli/gemini-3.1-pro-preview`
- compatibility aliases like `codex`, `claude`, and `gemini`

### Task 3: Integrate metadata and add adapter demo

**Files:**
- Modify: `src/schemas/runtime.ts`
- Modify: `src/schemas/planning.ts`
- Modify: `src/orchestrator/dag-builder.ts`
- Modify: `src/planning/planning-pipeline.ts`
- Create: `src/examples/run-openclaw-adapter-demo.ts`
- Modify: `package.json`

**Step 1: Thread resolved model metadata through existing records**

Keep current demos working while adding richer provider/model metadata where it fits cleanly.

**Step 2: Add adapter fixtures/demo**

Demonstrate:
- model catalog probing
- alias resolution
- planning request envelope shaping
- worker request envelope shaping

### Task 4: Update docs and verify

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap/2026-03-15-delivery-roadmap.md`

**Step 1: Document PR3 scope**

Update README and roadmap text to describe the adapter layer, exact model ids, and remaining PR4 bridge work.

**Step 2: Run verification**

Run:
- `npm run typecheck`
- `npm run build`
- `node --test tests/openclaw-runtime-adapter.test.mjs tests/openclaw-model-resolution.test.mjs`
- `node --test tests/planning-mode-resolution.test.mjs tests/planning-pipeline.test.mjs tests/orchestrator-runtime.test.mjs`

**Step 3: Notify completion**

Run:
- `openclaw system event --text "Done: implemented OpenClaw runtime adapter layer on feat/openclaw-adapter-pr3" --mode now`
