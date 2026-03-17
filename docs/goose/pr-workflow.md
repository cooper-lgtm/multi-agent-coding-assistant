# Goose Delivery Workflow (PR-sized)

This repository uses a branch-per-task goose delivery loop for roadmap execution.

## Standard Loop

1. Create a branch from `main` for exactly one task-sized slice.
2. Implement only that task scope.
3. Run local required verification commands.
4. Open a PR with GitHub CLI:
   - `gh pr create --fill --base main`
5. Let the automatic Codex review workflow run asynchronously.
   - No manual PR comment is required to trigger review.
6. If local required checks passed, merge without waiting for asynchronous review completion:
   - `gh pr merge --merge --delete-branch`

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
- Prefer one small, reviewable PR over broad multi-task changes.
