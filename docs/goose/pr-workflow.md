# Goose Delivery Workflow (PR-sized)

This repository uses a branch-per-task goose delivery loop for roadmap execution.

## Standard Loop

1. Create a branch from `main` for exactly one task-sized slice.
2. Implement only that task scope.
3. Refresh any repository context artifacts that the active Goose recipe requires while still on the task branch.
4. If that refresh changes checked-in files, include those updates in the same PR.
5. Run local required verification commands.
6. Open or update a PR with GitHub CLI:
   - `gh pr create --fill --base main`
7. Wait for required GitHub checks to pass.
8. Run the blocking local Codex review gate on the current PR head SHA.
9. If local review returns findings, rerun the same task with the normalized `prior_review` payload.
10. If local review fails because of timeout, auth, process, schema, or scope issues, stop as `manual_review_required`.
11. Merge only after both required checks and the blocking local review pass cleanly:
   - `gh pr merge --merge --delete-branch`
12. GitHub-hosted Codex review may still run asynchronously for comparison, follow-up fixes, and signaling, but it is no longer the Goose repair-loop source of truth.

## Required Local Verification Gate

Before opening/merging a PR, run:

```bash
npm run review:local
npm run typecheck
npm run build
npm run test:adapter
npm run test:planning
npm run test:runtime
node --test tests/goose-worker-contract.test.mjs
node --test tests/goose-recipe-builder.test.mjs
node --test tests/goose-worker-adapter.test.mjs
node --test tests/orchestrator-goose-runtime.test.mjs
node --test tests/orchestrator-approval-controls.test.mjs
node --test tests/orchestrator-policy-engine.test.mjs
node --test tests/orchestrator-e2e.test.mjs
node --test tests/cli-smoke.test.mjs
```

`npm run review:local` is the repository-standard local Codex review gate. It fails closed:
- exit `0` means the structured local review was clean
- exit `1` means Codex returned actionable findings
- exit `2` means the local review process failed or did not return a valid structured payload
- a stalled local `codex exec` is cut off by a 30 minute watchdog by default; override with `LOCAL_CODEX_REVIEW_TIMEOUT_MS` using a positive millisecond value
- when run inside this repository, uncommitted-mode review loads the prompt/schema from trusted mainline refs instead of the current branch's committed copies
- same-repo review also re-executes the runner from a frozen baseline before review logic starts: trusted mainline refs first, then the committed/staged same-repo runner when this branch has not landed on main yet
- same-repo `--base main` / `--base master` review may bootstrap from the explicit local mainline ref when no trusted remote mainline ref exists

## Guardrails

- Keep `test-agent` and `review-agent` under orchestrator ownership.
- Do not collapse `needs_fix`, `blocked`, and `failed`.
- Do not merge if any required local check fails.
- Do not merge if the blocking local review returns findings or `manual_review_required`.
- Do not merge from inside the Goose execution recipe; the outer plan runner owns required-check polling, local review, retry, and merge.
- Prefer one small, reviewable PR over broad multi-task changes.

## Scripted Plan Runner

For plan documents that should execute one task-sized PR at a time, the repository now includes:

```bash
npm run build && node scripts/run-plan-doc.mjs \
  --repo-path /absolute/path/to/repo \
  --plan-path /absolute/path/to/plan.md \
  --base-branch main
```

Current behavior:
- parses `### Task N: ...` headings from the target plan document
- runs goose once per task-sized slice and stops at `opened_not_merged`
- waits for required GitHub checks before merge
- treats required-check `fail` buckets as immediate failures, gives `cancel` / `cancelled` one grace poll so reruns can start, then fails fast if the required checks stay cancelled
- treats skipped required checks as pass-equivalent based on the required-check buckets themselves, so unrelated PR-level blockers such as pending review approval do not stall the checks gate
- runs one blocking local `codex exec` review on the current PR head SHA before merge
- scopes that blocking review to the task branch diff from merge-base to head, using the task's changed files, so unrelated untracked worktree files do not silently enter the gate
- reruns the same task when the local review returns findings, passing them back into Goose as machine-readable `prior_review`
- treats local review timeout or execution failure as `manual_review_required` instead of routing tool failures into author-fixable retry loops
- defaults both check and review waiting windows to 30 minutes
- supports `--checks-timeout-ms` and `--review-timeout-ms` overrides
- keeps GitHub-hosted Codex review as an optional asynchronous comparison signal rather than the blocking merge gate

Operator notes:
- deterministic fake dry runs live in `tests/run-plan-doc.test.mjs`; ad hoc fake runs can also set `PLAN_RUNNER_FAKE_STATE=/absolute/path/to/state.json` with `tests/fixtures/fake-bin` ahead of `PATH`
- disposable live runs should use a throwaway branch/plan, then invoke `npm run build && node scripts/run-plan-doc.mjs --repo-path /absolute/path/to/repo --plan-path /absolute/path/to/plan.md --base-branch main`

This script is intentionally validated first through deterministic fake `gh` / fake `goose` integration tests so the control flow can be trusted before relying on live external systems.
