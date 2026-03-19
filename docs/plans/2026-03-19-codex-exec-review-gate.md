# Codex Exec Review Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real local `review-agent` quality gate that runs strict Codex review through `codex exec --json`, records observable progress, and maps results into the existing orchestrator runtime.

**Architecture:** Keep the current orchestrator contracts intact and add Codex at the adapter seam. Phase 1 uses a child-process runner plus structured output normalization so the local orchestrator can observe progress and persist evidence without introducing SDK-managed thread state yet.

**Tech Stack:** TypeScript, Node child processes, Codex CLI, existing orchestrator/runtime modules, Node test runner

---

### Task 1: Add failing tests for the process runner and result normalization

**Files:**
- Create: `tests/codex-exec-process-runner.test.mjs`
- Create: `tests/codex-exec-review-adapter.test.mjs`

**Step 1: Write the failing tests**

Cover:
- child-process stdout/stderr/exit-code capture
- JSONL event parsing from `codex exec --json`
- normalization of a clean review into `completed`
- normalization of actionable findings into `needs_fix`
- malformed output or non-zero exit into `failed`

**Step 2: Run the new tests to verify they fail**

Run:

```bash
npm run build && node --test tests/codex-exec-process-runner.test.mjs tests/codex-exec-review-adapter.test.mjs
```

Expected:
- FAIL because the Codex process runner and review adapter do not exist yet

### Task 2: Add the Codex exec process runner

**Files:**
- Create: `src/adapters/codex-exec-process-runner.ts`
- Modify: `src/index.ts`

**Step 1: Add a typed invocation/result contract**

Define:
- invocation params for cwd, prompt path or prompt text, output schema path, and extra CLI args
- result shape for exit code, stdout, stderr, parsed events, and final response payload
- optional progress callback for streamed JSONL events

**Step 2: Implement the process runner**

Implement:
- `spawn('codex', ['exec', '--json', ...])`
- stdout/stderr buffering
- line-by-line JSONL parsing
- structured surfacing of process and parse failures

**Step 3: Run the process-runner tests**

Run:

```bash
npm run build && node --test tests/codex-exec-process-runner.test.mjs
```

Expected:
- PASS

### Task 3: Add the review prompt and output schema

**Files:**
- Create: `prompts/review-agent-codex-exec.md`
- Create: `prompts/review-agent-output-schema.json`
- Create: `docs/reviews/strict-codex-review-rubric.md`

**Step 1: Add the strict review prompt**

The prompt should:
- follow the repository rubric in `docs/reviews/strict-codex-review-rubric.md`
- stay short and high-signal
- focus on correctness and actionable findings
- prefer findings over summaries
- support task-scoped review using changed files
- require structured output compatible with runtime normalization

**Step 2: Add the strict rubric document**

Document:
- the OpenAI baseline rules from the official Codex review example
- the repository-specific strictness extensions
- severity discipline
- output discipline
- the “less is more” prompt rule from GPT-5-Codex guidance

**Step 3: Add the review schema**

Define a stable schema containing:
- findings
- overall correctness
- overall explanation
- confidence score

**Step 4: Sanity-check the prompt assets**

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('prompts/review-agent-output-schema.json','utf8'))"
```

Expected:
- command exits successfully

### Task 4: Add the Codex review adapter

**Files:**
- Create: `src/adapters/codex-exec-review-adapter.ts`
- Modify: `src/index.ts`

**Step 1: Build task-scoped review input**

Use:
- `task.changed_files`
- task title and description
- retry handoff context when present
- repository path from the runtime invocation context

The adapter should prefer file-scoped review when changed files exist and fall back to a repo diff strategy when they do not.

**Step 2: Normalize Codex output**

Map:
- no actionable findings -> `completed`
- one or more actionable findings -> `needs_fix`
- process/runtime/schema failure -> `failed`

Carry:
- findings into `review_feedback`
- execution notes into `commands_run`
- parser/process issues into `risk_notes`

**Step 3: Run adapter tests**

Run:

```bash
npm run build && node --test tests/codex-exec-review-adapter.test.mjs
```

Expected:
- PASS

### Task 5: Compose Codex review into the quality gate runner

**Files:**
- Create: `src/orchestrator/codex-exec-quality-gate-runner.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`

**Step 1: Add a real quality gate runner implementation**

The new runner should:
- preserve the current `QualityGateRunner` interface
- use Codex review when `review_required` is true
- preserve current fallback behavior for tests in this phase
- expose enough hooks to record progress events through the existing reporting path

**Step 2: Record progress events**

Add runtime event recording for:
- process spawn
- streamed progress
- clean completion
- malformed output
- process failure

**Step 3: Add focused integration tests**

**Files:**
- Create: `tests/codex-exec-quality-gate-runner.test.mjs`

Run:

```bash
npm run build && node --test tests/codex-exec-quality-gate-runner.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected:
- PASS

### Task 6: Add a runnable demo and documentation updates

**Files:**
- Create: `src/examples/run-codex-exec-review-demo.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Step 1: Add a local demo**

Demonstrate:
- invoking the review gate locally
- streaming progress
- persisting findings/evidence

**Step 2: Document the new local-review path**

Document:
- required Codex CLI/auth setup
- where progress is visible
- where findings are persisted
- what remains deferred to the SDK phase

### Task 7: Run repository validation

**Files:**
- Verify: `src/adapters/codex-exec-process-runner.ts`
- Verify: `src/adapters/codex-exec-review-adapter.ts`
- Verify: `src/orchestrator/codex-exec-quality-gate-runner.ts`
- Verify: `docs/reviews/strict-codex-review-rubric.md`
- Verify: `prompts/review-agent-codex-exec.md`
- Verify: `prompts/review-agent-output-schema.json`
- Verify: `tests/codex-exec-process-runner.test.mjs`
- Verify: `tests/codex-exec-review-adapter.test.mjs`
- Verify: `tests/codex-exec-quality-gate-runner.test.mjs`

**Step 1: Run focused validation**

Run:

```bash
npm run typecheck
npm run build
node --test tests/codex-exec-process-runner.test.mjs tests/codex-exec-review-adapter.test.mjs tests/codex-exec-quality-gate-runner.test.mjs tests/orchestrator-runtime.test.mjs
git diff --check
```

Expected:
- all commands exit successfully

## Deliverables

- a local Codex process runner
- a repository-visible strict review rubric based on OpenAI review practices
- a strict structured review prompt and output schema
- a Codex-backed quality gate runner for `review-agent`
- focused tests and a runnable demo
- documentation covering usage, observability, and deferred SDK follow-up
