# Goose Delivery Workflow (PR-sized)

This repository uses a branch-per-task goose delivery loop for roadmap execution.

## Standard Loop

1. Create a branch from `main` for exactly one task-sized slice.
2. Implement only that task scope.
3. Run local required verification commands.
4. Open a PR with GitHub CLI:
   - `gh pr create --fill --base main`
5. Run the local blocking Codex review gate after required checks pass.
   - If local review returns findings, rerun the same task with the normalized review feedback.
   - If local review fails because of timeout/auth/process/schema issues, stop as `manual_review_required`.
6. Merge only after both required local checks and the local blocking review pass cleanly:
   - `gh pr merge --merge --delete-branch`
7. The GitHub-hosted Codex review workflow may still run asynchronously for comparison and signaling.
   - It is not the source of truth for the Goose repair loop once local Codex review is wired in.

If the branch has not yet landed the local Codex review integration described by PR21, fall back to the older async GitHub-review flow for that branch only.

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
- Do not merge if the local blocking review returns findings or `manual_review_required`.
- Prefer one small, reviewable PR over broad multi-task changes.
