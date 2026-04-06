# Remove Goose After OMX Cutover

## Requirements Summary

After the OMX-backed plan-runner migration has landed and been verified in the active automation path, remove Goose as a first-class execution path from this repository. The goal is to reduce system weight, eliminate dual-maintenance of two execution stacks, and leave one clear automation story for Codex-hosted execution.

This is a cleanup-and-convergence PR, not the executor migration PR itself.

Execution gate before starting:
- do not implement this plan until the OMX cutover PR has landed on the target base branch
- do not delete Goose code while the active plan-runner path still depends on it

Grounded repository constraints:
- Goose currently appears in automation scripts, runtime adapters, demos, tests, docs, fixtures, and CLI/help text.
- The repository still carries Goose-specific worker adapters and runtime coverage outside the `run-plan-doc` script path.
- The current architecture rule is to preserve orchestration ownership boundaries and keep quality gates external.

## Acceptance Criteria

1. The repository no longer presents Goose as a supported automation path for task execution after OMX cutover is complete.
2. Goose-specific scripts, adapters, recipes, demos, and docs are removed or archived where they no longer have live consumers.
3. Runtime/docs/help/test surfaces converge on one active execution path instead of preserving parallel Goose and OMX narratives.
4. Any remaining historical Goose references are clearly marked as archived design history rather than current guidance.
5. Validation and CI targets no longer require Goose-specific suites once OMX replacement coverage exists.

## Cleanup Boundaries

In scope once OMX cutover is merged:
- `.goose/recipes/**`
- `docs/goose/**`
- `src/adapters/goose-*`
- Goose-specific exports from `src/index.ts`
- Goose-specific demos such as `demo:goose`
- Goose-specific tests and fixtures
- README / CLI / docs text that still treats Goose as normative

Out of scope for this cleanup PR:
- rewriting the orchestrator architecture
- changing required-check semantics
- changing the outer sequential `execute -> checks -> merge` contract
- broad unrelated test cleanup outside Goose removal

## Implementation Steps

### Step 1: Confirm no active automation path still depends on Goose
Files:
- [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md)
- [`scripts/run-plan-doc.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/scripts/run-plan-doc.mjs)
- OMX migration PR artifacts that replaced Goose

Work:
- Verify that the plan-runner automation path is OMX-backed on the base branch.
- Verify that no current user-facing instructions still require Goose to execute the standard workflow.
- Record the exact merged commit or PR that completed the cutover so cleanup has a named dependency.

### Step 2: Remove Goose from the active script/runtime surface
Files:
- `src/adapters/goose-recipe-builder.ts`
- `src/adapters/goose-process-runner.ts`
- `src/adapters/goose-worker-adapter.ts`
- `src/orchestrator/implementation-dispatcher.ts`
- `src/index.ts`
- `package.json`

Work:
- Remove Goose-backed execution code paths that no longer have live callers.
- Remove package scripts and exports that only exist for Goose.
- Keep the runtime contract intact while deleting the obsolete implementation path.

### Step 3: Remove Goose-specific docs and normative guidance
Files:
- [`README.md`](/Users/yezi/Documents/multi-agent-coding-assistant/README.md)
- `docs/goose/pr-workflow.md`
- `docs/goose/task-contract.md`
- any current docs that still instruct operators to use Goose

Work:
- Replace current Goose workflow guidance with OMX workflow guidance where needed.
- Delete Goose-only docs that no longer describe supported behavior.
- Retain only minimal archival references when needed for design history.

### Step 4: Remove Goose-specific tests, fixtures, and demos
Files:
- `tests/goose-worker-contract.test.mjs`
- `tests/goose-recipe-builder.test.mjs`
- `tests/goose-worker-adapter.test.mjs`
- `tests/orchestrator-goose-runtime.test.mjs`
- Goose-specific fixtures under `tests/fixtures/**`
- `src/examples/run-goose-worker-demo.ts`

Work:
- Delete tests that only validate removed Goose behavior.
- Replace any shared contract coverage with OMX-backed equivalents before deletion.
- Remove demo and fixture artifacts that only support Goose.

### Step 5: Converge help text and validation targets
Files:
- [`src/cli/main.ts`](/Users/yezi/Documents/multi-agent-coding-assistant/src/cli/main.ts)
- [`tests/cli-smoke.test.mjs`](/Users/yezi/Documents/multi-agent-coding-assistant/tests/cli-smoke.test.mjs)
- CI or local validation docs that still name Goose

Work:
- Remove `mock|goose` wording if it is no longer true.
- Update smoke tests and validation docs to reflect the post-Goose baseline.
- Make sure the repository advertises one execution story instead of legacy alternatives.

## Risks and Mitigations

- Risk: Goose still has hidden consumers outside the plan-runner path.
  Mitigation: search the repo first, verify the OMX cutover has landed, then delete in dependency order.

- Risk: cleanup removes useful coverage before OMX replacement tests are in place.
  Mitigation: only delete Goose-specific tests after equivalent OMX/path-level coverage exists.

- Risk: docs drift leaves operators with a mixed Goose/OMX workflow story.
  Mitigation: treat README, workflow docs, CLI/help text, and validation guidance as one cleanup unit.

## Verification Steps

Minimum cleanup verification:
- `npm run build`
- `npm run typecheck`
- targeted tests for the OMX-backed replacement path
- `tests/cli-smoke.test.mjs`
- `git diff --check`

Behavioral verification requirements:
- prove the active plan-runner workflow no longer requires Goose anywhere
- prove no active docs still instruct operators to use Goose
- prove the repo's public help text and validation guidance match the post-Goose baseline

## ADR

### Decision
After OMX cutover is complete, remove Goose entirely instead of preserving it as a parallel legacy execution option.

### Drivers
- reduce maintenance cost
- remove duplicate execution narratives
- converge the repository on one automation path

### Alternatives Considered
- keep Goose indefinitely as a fallback path
- migrate `run-plan-doc` to OMX but leave the rest of Goose in place

### Why Chosen
Once OMX is the supported automation path, keeping Goose mostly preserves complexity rather than optionality. A separate cleanup PR keeps migration risk and deletion risk decoupled.

### Consequences
- a future cleanup PR will delete a large amount of Goose-specific surface area
- historical Goose design docs become archival rather than normative
- the repo should become simpler to explain and maintain
