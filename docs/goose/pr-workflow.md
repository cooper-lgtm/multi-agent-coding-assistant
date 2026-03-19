# Goose Delivery Workflow (PR-sized)

This repository uses a branch-per-task goose delivery loop for roadmap execution.

## Standard Loop

1. Create a branch from `main` for exactly one task-sized slice.
2. Implement only that task scope.
3. Refresh any repository context artifacts that the active Goose recipe requires while still on the task branch.
4. If that refresh changes checked-in files, include those updates in the same PR.
5. Run local required verification commands.
6. Open a PR with GitHub CLI:
   - `gh pr create --fill --base main`
7. If local required verification passed, merge without waiting for the automatic GitHub-hosted Codex review workflow to finish:
   - `gh pr merge --merge --delete-branch`
8. The GitHub-hosted Codex review workflow may still run asynchronously for comparison, follow-up fixes, and signaling.

This is the current checked-in repository contract. The blocking local Codex review loop described by PR21 is still the target state, not the default runtime behavior on `main` yet.

## Target Loop Once PR21 Lands

After the local Codex review adapter and Goose integration described by PR21 actually land, the intended loop becomes:

1. Refresh any required repository context artifacts on the task branch and include those updates in the same PR before merge.
2. Run the local blocking Codex review gate after required checks pass.
3. If local review returns findings, rerun the same task with the normalized review feedback.
4. If local review fails because of timeout/auth/process/schema issues, stop as `manual_review_required`.
5. Merge only after both required local checks and the local blocking review pass cleanly.
6. Keep GitHub-hosted Codex review as an optional asynchronous comparison signal rather than the Goose repair-loop source of truth.

## Required Local Verification Gate

Before opening/merging a PR, run:

```bash
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

## Guardrails

- Keep `test-agent` and `review-agent` under orchestrator ownership.
- Do not collapse `needs_fix`, `blocked`, and `failed`.
- Do not merge if any required local check fails.
- Until PR21 lands, do not wait on the GitHub-hosted Codex review workflow before merging once required local checks pass.
- After PR21 lands, do not merge if the local blocking review returns findings or `manual_review_required`.
- Prefer one small, reviewable PR over broad multi-task changes.
