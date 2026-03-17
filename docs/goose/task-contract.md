# Goose Implementation Task Contract

Goose recipes for implementation workers must return a **candidate** task result for the orchestrator.

## Required behavior

1. Read harness docs before edits:
   - `README.md`
   - `PRODUCT.md`
   - `ARCHITECTURE.md`
   - `AGENTS.md`
2. Explore repository context before modifying files.
3. Stay within the assigned task scope.
4. Run required local verification commands for the task.
5. Return structured output matching `.goose/recipes/shared/worker-output-schema.json`.
6. Do not claim global run completion; orchestrator-owned quality gates make final status decisions.

## Required output fields

- `status` (`implementation_done` | `blocked` | `failed`)
- `summary`
- `changed_files`
- `blocker_category`
- `blocker_message`
- `implementation_evidence`
- `test_evidence`
- `review_feedback`
- `commands_run`
- `test_results`
- `risk_notes`
- `suggested_status`
- `delivery_metadata`

This keeps implementation evidence and quality-gate ownership separate while preserving retry handoff context.
