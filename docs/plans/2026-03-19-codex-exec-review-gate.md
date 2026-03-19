# Codex Exec Review Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real local Codex review path that runs strict review through `codex exec --json`, replaces GitHub review scraping in the Goose automation loop, and stays reusable by the orchestrator quality-gate seam once that seam has the required review context.

**Architecture:** Add Codex at the adapter seam, but integrate it in two phases. Phase 1 replaces GitHub review scraping in the Goose plan-runner flow with a local `codex exec` review adapter. If the PR20 automation slice is not yet present on the base branch, land that dependency first or retarget this phase to the checked-in Goose automation entrypoint that actually exists, and update the matching tests and validation commands in the same change. Phase 2 reuses that same adapter inside `QualityGateRunner` after the runtime has explicit review-scope inputs and a persistence hook for mid-review progress.

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
- normalization of a clean review into a clean local-review result
- normalization of actionable findings into a findings result
- contradictory successful payloads such as `findings.length > 0` with `overall_correctness = patch is correct` being rejected during adapter normalization
- malformed output, timeout, auth failure, or non-zero exit into a review-infrastructure result

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
- timeout controls for the overall review duration and graceful/forced child-process termination
- result shape for exit code, stdout, stderr, parsed events, and final response payload
- optional progress callback for streamed JSONL events

**Step 2: Implement the process runner**

Implement:
- `spawn('codex', ['exec', '--json', '-c', 'approval_policy=never', '--sandbox', 'read-only', ...])` or an equivalent non-interactive config profile
- explicit timeout handling so stalled review processes are killed and surfaced as infrastructure failures
- stdout/stderr buffering
- line-by-line JSONL parsing
- structured surfacing of process and parse failures

The process runner should stay generic. Keep review-specific outcome mapping out of this layer so future non-review `codex exec` calls can reuse it.

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
- support explicit diff-scoped review using changed files plus base/diff context
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
- explicit severity values aligned with the prompt and rubric
- successful-review field shapes that remain compatible with Codex strict structured outputs

Keep the verdict rule that ties `overall_correctness` to the findings count in prompt instructions plus adapter normalization.
Do not rely on JSON Schema conditionals such as `allOf` / `if` / `then`, because the strict structured-output schema subset rejects them.

**Step 4: Sanity-check the prompt assets**

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('prompts/review-agent-output-schema.json','utf8'))"
codex exec --json --ephemeral -s read-only -c approval_policy=never --output-schema prompts/review-agent-output-schema.json 'Return an empty review with no findings, overall_correctness set to patch is correct, a short overall_explanation, and overall_confidence_score 0.5.'
```

Expected:
- both commands exit successfully

### Task 4: Add the Codex review adapter

**Files:**
- Create: `src/adapters/codex-exec-review-adapter.ts`
- Modify: `src/index.ts`

**Step 1: Build task-scoped review input**

Use:
- `repo_path`
- `base_ref` or `base_sha`
- changed files when available
- task title and description
- retry handoff context when present

The adapter should fail closed when explicit review scope is missing. It should not silently widen to a repository-wide review.

**Step 2: Normalize Codex output**

Map:
- no actionable findings -> local result `clean`
- one or more actionable findings -> local result `findings`
- process/runtime/schema/auth/timeout failure -> local result `manual_review_required`

Carry:
- findings into normalized review feedback
- execution notes into `commands_run`
- parser/process issues into `risk_notes`

Note:
- the JSON schema constrains the model's successful review payload
- infrastructure failures must be represented by the adapter contract rather than forced through the model-output schema
- overall verdict fields such as correctness, explanation, and confidence belong to the successful model payload described by the schema
- `manual_review_required` is an adapter-only outcome for timeout/auth/process/schema failures, not a second model JSON shape
- adapter normalization should reject contradictory successful payloads where the findings count and `overall_correctness` disagree, even though the strict schema subset cannot enforce that relationship directly
- adapter normalization should also reject impossible successful payloads such as reversed line ranges even when the JSON schema cannot express that cross-field rule by itself

**Step 3: Run adapter tests**

Run:

```bash
npm run build && node --test tests/codex-exec-review-adapter.test.mjs
```

Expected:
- PASS

### Task 5: Integrate local Codex review into the Goose plan runner

**Files:**
- Modify: `src/automation/plan-runner.ts`
- Modify: `scripts/run-plan-doc.mjs`
- Modify: `tests/plan-runner.test.mjs`
- Modify: `tests/run-plan-doc.test.mjs`

**Step 1: Replace GitHub review scraping with the local review adapter**

The Goose automation should:
- keep required-check polling as-is
- run local Codex review after required checks pass
- use `repoPath`, `baseBranch`, changed files, and current task context as review scope
- invoke Codex in a non-interactive mode with explicit approval policy and sandbox settings so automation cannot stall waiting for approval
- carry normalized findings back into the existing repair loop

If `src/automation/plan-runner.ts` and `scripts/run-plan-doc.mjs` are not present on the target base branch, first land that dependency or retarget this task to the checked-in Goose automation entrypoint that owns the PR-sized loop. When retargeting, update the affected file list, integration tests, and validation commands so they cover the actual entrypoint being changed.

**Step 2: Preserve correct stop semantics**

Map local review outcomes to the existing Goose automation states:
- clean review -> merge and continue
- findings -> rerun the same task with `prior_review`
- review timeout/auth/process/schema failure -> `manual_review_required`

Do not send local review infrastructure failures back through the implementation retry loop as if the author needs to change code.

**Step 3: Add focused integration tests**

Cover:
- required checks still gate review
- clean local review allows merge
- local review findings rerun the same task
- local review timeout or process failure stops as `manual_review_required`

If this task was retargeted to a different Goose entrypoint, replace the test files below with the tests that directly exercise that entrypoint.

Run:

```bash
npm run build && node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs
```

Expected:
- PASS

### Task 6: Compose Codex review into the orchestrator quality gate seam

**Files:**
- Create: `src/orchestrator/codex-exec-quality-gate-runner.ts`
- Modify: `src/orchestrator/quality-gate-runner.ts`
- Modify: `src/orchestrator/main-orchestrator.ts`

**Step 1: Add the missing runtime prerequisites**

Before wiring in the real runner, add or confirm:
- explicit review-scope input for `repo_path`, `base_ref` or `base_sha`, and diff target
- a persistence hook for mid-review progress so long-running local review events survive process interruption
- failure classification that distinguishes review infrastructure failure from author-fixable findings

**Step 2: Add a real quality gate runner implementation**

The new runner should:
- preserve the current `QualityGateRunner` interface
- use Codex review when `review_required` is true
- preserve current fallback behavior for tests in this phase
- expose enough hooks to record and persist progress events while the process is still running

**Step 3: Record progress events**

Add runtime event recording for:
- process spawn
- streamed progress
- clean completion
- malformed output
- process failure

**Step 4: Add focused integration tests**

**Files:**
- Create: `tests/codex-exec-quality-gate-runner.test.mjs`

Run:

```bash
npm run build && node --test tests/codex-exec-quality-gate-runner.test.mjs tests/orchestrator-runtime.test.mjs
```

Expected:
- PASS

### Task 7: Add a runnable demo and documentation updates

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
- Goose automation integration points and state mapping
- required Codex CLI/auth setup
- where progress is visible
- where findings are persisted
- what remains deferred to the SDK phase

### Task 8: Run repository validation

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

If Task 5 was retargeted to a different Goose entrypoint, replace the Phase 1 test commands below with the tests that directly exercise that entrypoint.

Run:

```bash
npm run typecheck
npm run build
node --test tests/codex-exec-process-runner.test.mjs tests/codex-exec-review-adapter.test.mjs tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs
node --test tests/codex-exec-quality-gate-runner.test.mjs tests/orchestrator-runtime.test.mjs
git diff --check
```

Expected:
- all commands exit successfully

## Deliverables

- a local Codex process runner
- a repository-visible strict review rubric based on OpenAI review practices
- a strict structured review prompt and output schema
- a Goose-integrated local Codex review path that replaces GitHub review scraping
- an orchestrator-ready Codex-backed quality gate runner plan with explicit prerequisites
- focused tests and a runnable demo
- documentation covering usage, observability, and deferred SDK follow-up
