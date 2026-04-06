# OMX-Backed Sequential Plan Runner Without Local Pre-Push Review

## Requirements Summary

Replace the Goose-backed task execution path in [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs#L19) with an OMX-backed executor while preserving the existing sequential task control loop in [`src/automation/plan-runner.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/automation/plan-runner.ts#L65), preserving branch-per-task and PR-per-task delivery, and preserving required GitHub checks before merge. Per user direction, remove the blocking local pre-push Codex review gate from the automated workflow defined in [`docs/goose/pr-workflow.md`](/Users/yezi/Documents/multi-agent-coding-assistant/docs/goose/pr-workflow.md#L27) and [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md#L217).

Grounded repository constraints:
- `run-plan-doc.mjs` currently shells out to Goose for `executeTaskSlice`, installs hooks, propagates local review timeout, polls required checks, and merges [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs#L119).
- `runPlanTaskSequence()` already owns the sequential `execute -> wait checks -> merge` contract and should remain the single outer coordinator [`src/automation/plan-runner.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/automation/plan-runner.ts#L46).
- The installed pre-push hook currently enforces local Codex review on push [`.githooks/pre-push`](/Users/yezi/Documents/multi-agent-coding-assistant/.githooks/pre-push#L85).
- The hook installer hardwires `.githooks/pre-push` and sets `core.hooksPath` [`scripts/install-git-hooks.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/install-git-hooks.mjs#L31).
- The CLI only advertises `mock|goose` as execution runtimes today [`src/cli/main.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/cli/main.ts#L15).

## Acceptance Criteria

1. `scripts/run-plan-doc.mjs` no longer shells out to `goose run --recipe .goose/recipes/execute-next-plan-task.yaml` and no longer installs git hooks or propagates local review timeout state in the main automated path.
2. A new OMX executor seam exists with an explicit contract for task execution that preserves the existing `ExecutedTaskSlice` shape in [`src/automation/plan-runner.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/automation/plan-runner.ts#L6), including explicit handling for no-op / no-commit outcomes.
3. The automated plan runner still performs, in order, one task slice execution, required-check polling, and merge per task; existing sequential merge discipline remains unchanged.
4. The automated task workflow pushes directly without depending on `.githooks/pre-push`, `hooks:install`, or `review:local` as blocking gates, and the automation-owned push path explicitly bypasses any locally configured git hooks.
5. Repository docs clearly state that for this workflow the blocking local pre-push Codex review gate is removed; required GitHub checks remain the only blocking merge gate.
6. The docs/help surfaces no longer present `mock|goose` as the only execution-runtime choices for the plan-runner automation path, while avoiding any claim that `maca run --execution-runtime omx` is already wired if that CLI path remains scaffold-only.
7. Tests cover the OMX executor contract, the rewired `run-plan-doc` integration, preserved required-check semantics, and the explicit removal of hook-install/review-gate behavior from the automated path.

## RALPLAN-DR Summary

### Principles
- Keep the outer sequential orchestration contract stable.
- Move executor-specific side effects behind an explicit seam.
- Change workflow policy intentionally and document it everywhere it is normative.
- Prefer structured machine-readable OMX output over prompt-string scraping.
- Keep v1 scope narrow: sequential only, no dependency/DAG parallelism work.

### Decision Drivers
- Preserve the proven `execute -> checks -> merge` state machine.
- Reduce operational fragility by replacing Goose recipe invocation with a better-structured OMX execution surface.
- Honor the user's desired workflow change: direct push, no blocking local code review.

### Viable Options

#### Option A: Minimal patch, keep Goose, only disable hook installation/review gate
Pros:
- Smallest code change.
- Preserves existing tested Goose path.

Cons:
- Does not solve the user's core complaint about Goose instability.
- Leaves the most fragile black-box execution surface untouched.

#### Option B: Recommended, keep the outer plan runner and replace only the task executor with OMX
Pros:
- Preserves stable orchestration logic.
- Uses OMX where it is strongest: bounded task execution and recovery.
- Limits migration risk to one seam.

Cons:
- Still requires a custom adapter/wrapper around OMX.
- Needs doc/test updates across both executor and policy surfaces.

#### Option C: Full OMX-native rewrite of planning + execution + delivery orchestration
Pros:
- One unified orchestration model.
- Long-term conceptual consistency.

Cons:
- Largest rewrite.
- Invalidates too much existing test and workflow surface at once.
- Unnecessarily broad for the current goal.

### Recommendation

Choose Option B. Keep [`src/automation/plan-runner.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/automation/plan-runner.ts#L65) unchanged as the outer state machine, replace the Goose-backed `executeTaskSlice` path with an explicit OMX executor contract, and treat the removal of local pre-push review as a separate workflow-policy update within the same scoped change.

## Implementation Steps

### Step 1: Split `run-plan-doc.mjs` before swapping executors
Files:
- [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs)
- New: `scripts/lib/github-required-checks.mjs` or equivalent helper module
- New: `scripts/run-omx-task.mjs` or `src/adapters/omx-task-executor.ts`

Work:
- Treat decomposition as a migration prerequisite, not as optional polish. The current `run-plan-doc.mjs` mixes CLI argument parsing, Goose execution, hook/review policy, GitHub required-check polling, and fake-review test support in one file.
- Keep `scripts/run-plan-doc.mjs` as the thin orchestration entrypoint that only:
  - parses CLI args
  - reads the plan document
  - wires dependencies into `runPlanTaskSequence()`
- Move executor-specific task execution into a dedicated OMX wrapper module.
- Move required-check polling and rerun/cancel normalization into a focused GitHub-checks helper module so that executor migration does not keep touching check semantics.
- Move any legacy local-review / hook-specific support out of the main plan-runner path so the OMX migration is not coupled to historical Goose review behavior.
- Preserve existing behavior while splitting:
  - sequential task ordering
  - required-check polling semantics
  - merge-after-checks ownership in the outer runner

Target post-split responsibilities:
- `scripts/run-plan-doc.mjs`: entrypoint and dependency wiring only
- OMX wrapper module: branch/task execution, push, PR create/update, normalized `ExecutedTaskSlice` output
- GitHub-checks helper: `gh pr checks` polling and required-check normalization
- legacy review/hook utilities: optional/manual-only paths outside the automated runner

Why this step is first:
- it reduces migration risk by separating "replace Goose" from "untangle historical script coupling"
- it keeps the OMX executor seam small and testable
- it avoids recreating the same coupling with OMX under a different command name

### Step 2: Define the OMX executor seam and keep the outer control loop unchanged
Files:
- [`src/automation/plan-runner.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/automation/plan-runner.ts)
- [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs)
- New: `scripts/run-omx-task.mjs` or `src/adapters/omx-task-executor.ts`

Work:
- Preserve the `PlanTaskSequenceDependencies` surface and `ExecutedTaskSlice` output shape so `runPlanTaskSequence()` remains the only sequential orchestrator.
- Introduce an explicit OMX executor contract for the `executeTaskSlice` seam rather than inlining shell details in `run-plan-doc.mjs`.
- Define exact failure mapping for OMX task execution:
  - `completed` + PR opened => success path (`opened_not_merged`)
  - no branch, no PR, or no committed diff relative to `baseBranch` => `blocked`
  - executor-reported `merge_status: "merged"` => contract violation and outer-runner failure
  - explicit task execution failure => `failed`
- Define branch/PR ownership explicitly in the executor contract instead of leaving it implicit in prompt text.
- Require the executor seam to decide explicitly whether a task produced a pushable branch delta, instead of letting `git push` / `gh pr create` discover that late.

Required contract fields for the new OMX executor result:
- `status`
- `selected_task`
- `branch_name`
- `pr_url`
- `merge_status`
- `changed_files`
- `validation_commands`
- optional `risks`
- optional `follow_up`

Additional required executor invariants:
- the executor must not merge the PR; it may only return `opened_not_merged` or `not_opened`
- the executor must verify that the task branch has a committed diff before pushing or creating/updating a PR
- a clean/no-op execution must return a normalized blocked/not-opened result instead of attempting push/PR creation

### Step 3: Implement a structured OMX task execution entrypoint
Files:
- New: `scripts/run-omx-task.mjs`
- Optional shared schema: `scripts/lib/omx-task-output.schema.json`
- [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs)

Work:
- Use `omx exec` as the non-interactive execution surface because it supports structured output via `--output-schema`, last-message capture, and non-interactive invocation.
- Build a dedicated wrapper script that:
  - prepares the task branch/worktree from `baseBranch`
  - assembles a bounded task brief using `taskHint`, `planPath`, `designDocPath`, and `taskDocPaths`
  - invokes `omx exec` with a schema-constrained JSON result
  - captures changed files and validation commands
  - verifies whether the task produced a committed branch delta; if not, returns a normalized `blocked` + `not_opened` result without attempting push or PR creation
  - pushes the task branch directly using an explicit automation-owned hook-bypass mechanism such as `git -c core.hooksPath=/dev/null push ...`
  - creates or updates the PR with `gh pr create --fill --base <baseBranch>` or equivalent update logic
  - emits only the normalized `ExecutedTaskSlice` JSON expected by the outer runner
- Make "commit before push" an explicit wrapper responsibility. If OMX edits files but leaves only a dirty worktree, the wrapper should fail/normalize that outcome instead of implicitly pushing nothing.
- Keep merge ownership in the outer runner. The OMX wrapper may prepare branch state and PR state, but it must never call `gh pr merge`.
- Keep prompt/brief generation inside the wrapper, not in `run-plan-doc.mjs`, so the runner stays orchestration-only.

### Step 4: Remove local pre-push review from the automated workflow path
Files:
- [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs)
- [`docs/goose/pr-workflow.md`](/Users/yezi/Documents/multi-agent-coding-assistant/docs/goose/pr-workflow.md)
- [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md)
- [`package.json`](/Users/yezi/Documents/multi-agent-coding-assistant/package.json)

Work:
- Remove the call to `ensureGitHooksInstalled()` from the automated plan-runner path.
- Remove `reviewTimeoutMs` propagation from the automated executor path because there is no longer a blocking local review process to inherit it.
- Define the exact hook-bypass mechanism for automation-owned pushes and apply it only to the scripted runner path, not to general contributor guidance.
- Rewrite the workflow docs so the normative automated path becomes:
  - task branch
  - OMX task execution
  - direct push
  - PR create/update
  - required checks
  - merge
- Update command guidance to stop presenting `hooks:install`, `review:local`, and `verify:local-review-gate` as required for the plan-runner automation path.
- For v1, keep the review scripts and hook files in the repository as optional/manual legacy utilities unless implementation proves they are dead and safe to delete in the same change.

### Step 5: Update docs/help surfaces to acknowledge the script-only OMX execution path
Files:
- [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md)
- [`src/cli/main.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/cli/main.ts) only if the help text is intentionally narrowed or annotated to avoid a false OMX claim
- any runtime docs that currently say `mock|goose`

Work:
- Treat OMX as a plan-runner script executor path first, not as a fully wired `maca run` runtime, unless the implementation also connects the CLI end-to-end in the same change.
- Update README and workflow docs to avoid stale `mock|goose` language where the plan-runner automation path now supports OMX.
- If `src/cli/main.ts` remains scaffold-only, do not advertise `mock|goose|omx` there. Instead, add a scoped note or leave the CLI runtime list untouched until the CLI path is actually wired.

### Step 6: Rework tests around contracts, not Goose literals
Files:
- [`tests/plan-runner.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/plan-runner.test.mjs)
- [`tests/run-plan-doc.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/run-plan-doc.test.mjs)
- [`tests/cli-smoke.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/cli-smoke.test.mjs)
- [`tests/install-git-hooks.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/install-git-hooks.test.mjs)
- [`tests/pre-push-hook.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/pre-push-hook.test.mjs)
- [`scripts/verify-local-review-gate.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/verify-local-review-gate.mjs)

Work:
- Keep `tests/plan-runner.test.mjs` focused on the unchanged sequential control-loop contract.
- Add focused coverage for the split boundaries so `run-plan-doc.mjs` does not silently re-absorb executor or review logic later.
- Update `tests/run-plan-doc.test.mjs` so it asserts executor-agnostic behavior where possible:
  - task order
  - linked design/task docs propagation
  - required-check polling
  - merge timing
- Add focused tests for the new helper boundaries:
  - OMX wrapper returns normalized `ExecutedTaskSlice`
  - GitHub-checks helper preserves pass/fail/cancelled/skipped semantics
- Replace Goose command literal assertions with OMX executor invocation/result assertions.
- Remove or rewrite tests whose only purpose is validating automatic pre-push review behavior in the plan-runner path.
- Add a regression test that seeds a failing local pre-push hook configuration and proves the OMX automation path still pushes, opens/updates the PR, and proceeds to required-check polling.
- Update CLI smoke tests for any new OMX runtime/help text.
- Decide whether `install-git-hooks` and `pre-push-hook` tests remain as optional utility coverage or are removed from the primary repo validation target.

### Step 7: Update plan and workflow docs that encode the old invariant
Files:
- [`docs/goose/pr-workflow.md`](/Users/yezi/Documents/multi-agent-coding-assistant/docs/goose/pr-workflow.md)
- [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md)
- relevant historical plans in `docs/plans/` only if they are referenced as current guidance

Work:
- Update the operator-facing docs so the active contract no longer claims that the local pre-push review gate is the only blocking review source of truth.
- If historical design docs remain in-repo, add a short note where necessary to distinguish superseded Goose/review-gated assumptions from the new OMX/direct-push workflow.
- Keep documentation aligned with the actual implementation surface to avoid stale contributor guidance.

## Risks and Mitigations

- Risk: Removing pre-push review lowers one established fail-closed quality barrier.
  Mitigation: Keep required GitHub checks as the merge gate; document the policy change explicitly; preserve focused validation commands in the OMX executor.

- Risk: OMX non-interactive task execution may not naturally return a stable machine-readable result.
  Mitigation: constrain the final output with `omx exec --output-schema` and normalize it in a wrapper script before the outer runner consumes it.

- Risk: Existing tests and docs encode Goose/review-specific assumptions across many files.
  Mitigation: separate executor-contract updates from control-loop assertions; rewrite only the tests that bind to the executor seam or review policy.

- Risk: replacing Goose before decomposing `run-plan-doc.mjs` will just move the same coupling onto OMX, making the new executor hard to verify and hard to clean up later.
  Mitigation: split the entrypoint, executor wrapper, and required-check helper first, then swap the executor behind the same outer contract.

- Risk: Branch/PR ownership remains ambiguous and leads to duplicate PRs or wrong branch naming.
  Mitigation: define branch naming, push behavior, and PR create/update ownership directly in the OMX executor contract before implementation.

- Risk: an already-configured local `core.hooksPath` still triggers a blocking pre-push review even after hook installation is removed from the runner.
  Mitigation: make automation-owned pushes use an explicit scoped hook bypass and cover that behavior with a regression test.

- Risk: OMX task execution may finish with only a dirty worktree or an empty/no-op branch, causing `git push` / `gh pr create` to fail late and opaquely.
  Mitigation: require the wrapper to detect committed branch deltas before push, and normalize no-op outcomes into `blocked` + `not_opened`.

## Verification Steps

Minimum implementation verification:
- `npm run build`
- `npm run typecheck`
- `node --test tests/plan-runner.test.mjs tests/run-plan-doc.test.mjs tests/cli-smoke.test.mjs`
- additional targeted tests for the new OMX executor wrapper
- `git diff --check`

If hook/review utilities remain in the repository but become optional/manual-only:
- run any retained utility coverage separately and remove it from the primary automated path if it no longer defines the normative workflow.

Behavioral verification requirements:
- prove that one task still executes, opens/updates a PR, waits for required checks, and merges only after checks pass
- prove that skipped required checks remain pass-equivalent if that contract is still intended
- prove that cancelled required-check grace logic remains unchanged
- prove that `checksTimeoutMs` still maps to `manual_review_required`
- prove that the automated workflow no longer installs hooks or requires local review to push
- prove that an existing failing pre-push hook does not block the automation-owned push path
- prove that a no-op / no-commit OMX task result is normalized before push/PR creation
- prove that the executor cannot merge early and that any unexpected `merge_status: "merged"` still fails closed in the outer runner
- prove that `run-plan-doc.mjs` remains a thin coordinator after the split and does not keep executor-specific logic inline

## ADR

### Decision
Adopt a mixed OMX workflow: keep the existing sequential plan-runner control loop, replace Goose task execution with an explicit OMX executor seam, and remove the blocking local pre-push Codex review gate from the automated workflow.

### Drivers
- Preserve stable sequential merge semantics already encoded in `plan-runner.ts`.
- Replace the more fragile Goose-backed task execution surface with OMX.
- Match the user’s desired workflow: direct push, no blocking local review.

### Alternatives Considered
- Keep Goose and only remove the hook/review gate.
- Rewrite the entire orchestration flow as fully OMX-native.

### Why Chosen
This option preserves the smallest stable contract that already works while moving only the part the user actually wants replaced: task execution. It also localizes the review-policy change so it can be documented and tested deliberately.

### Consequences
- The repository’s active workflow contract changes materially: local pre-push review is no longer a required gate.
- Docs and tests that treated Goose and local review as normative must be updated together.
- A new OMX executor seam becomes a first-class maintenance surface.
- The executor contract now also owns no-op normalization and must not leak merge ownership back inward.

### Follow-ups
- Consider a later v2 for parallel task execution once sequential OMX delivery is stable.
- Consider deleting legacy hook/review utilities entirely after one migration cycle if they become unused.
- Consider adding resumable OMX executor state if task execution proves long-running or failure-prone.

## Available-Agent-Types Roster

- `planner`: task sequencing and plan refinement
- `architect`: executor seam and workflow-boundary review
- `critic`: plan-quality and acceptance-criteria enforcement
- `executor`: implementation of the OMX executor and script rewiring
- `debugger`: task-execution failure mapping and retry diagnosis
- `test-engineer`: regression and contract test updates
- `writer`: README/workflow/CLI docs alignment
- `verifier`: final evidence pass on preserved checks/merge semantics

## Follow-up Staffing Guidance

### Ralph path
Recommended roles:
- 1 `executor` (high): implement the executor seam and script rewiring
- 1 `test-engineer` (medium): update contract/integration tests in parallel where possible
- 1 `writer` (high): update README and workflow docs after implementation details stabilize
- 1 `verifier` (high): final evidence pass over required-check and no-hook-install semantics

Why this lane mix:
- The work is sequential at the feature level, but the implementation, docs, and verification slices are still separable enough for supervised follow-up.

Suggested launch hint:
- `omx ralph --prd "Implement .omx/plans/2026-04-05-omx-plan-runner-without-local-review.md in /Users/yezi/Documents/multi-agent-coding-assistant"`

### Team path
Recommended staffing:
- 2 `executor` lanes: executor seam + runner rewiring, and docs/runtime surface updates
- 1 `test-engineer` lane: test migration and fixture updates
- 1 `verifier` lane: contract/evidence validation before shutdown

Suggested launch hint:
- `omx team 4:executor "Implement plan .omx/plans/2026-04-05-omx-plan-runner-without-local-review.md in /Users/yezi/Documents/multi-agent-coding-assistant"`

## Team Verification Path

Before team shutdown, prove:
- `run-plan-doc` no longer shells Goose
- the automated path no longer installs hooks or requires local review to push
- the sequential `execute -> required checks -> merge` contract still holds
- docs and CLI text no longer claim local pre-push review is the required blocking gate

After team handoff, Ralph/final verifier should confirm:
- targeted tests pass from fresh output
- no stale Goose/review-gate contract text remains in active docs/help surfaces
- changed files and remaining risks are explicitly documented

## Changelog From Review Feedback

Applied after Architect review:
- made the executor seam explicit instead of treating OMX as a drop-in shell command swap
- split “executor replacement” from “workflow policy removal” so their boundaries are testable
- added CLI/runtime/documentation touchpoints that still encode `mock|goose`

Applied after Critic review:
- added a concrete OMX invocation direction using `omx exec --output-schema`
- defined the expected OMX executor result shape and failure mapping responsibilities
- expanded the test/doc update list to include CLI smoke, hook utility coverage, and review-gate verification surfaces
- explicitly narrowed preserved regressions to the sequential orchestration and required-check semantics
- added an explicit automation-owned hook-bypass requirement plus regression coverage for preconfigured failing hooks

Applied after implementation review:
- made no-op / no-commit outcomes explicit executor-contract cases instead of leaving them to push/PR failures
- re-stated that merge ownership must stay in the outer runner and that executor-reported `merged` is a fail-closed contract violation
- narrowed OMX acknowledgement from "CLI runtime support" to the plan-runner script path unless `maca run` is wired in the same change

Applied after follow-up planning:
- elevated `run-plan-doc.mjs` decomposition into the first migration step instead of treating it as optional cleanup
- named the target module split so executor migration, GitHub-check semantics, and legacy review utilities stop sharing one script file
