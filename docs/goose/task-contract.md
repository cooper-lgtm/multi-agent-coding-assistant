# Goose Implementation Task Contract

Goose recipes for implementation workers must return a **candidate** task result for the orchestrator.

## Required behavior

1. Read harness docs before edits:
   - `README.md`
   - `PRODUCT.md`
   - `ARCHITECTURE.md`
   - `AGENTS.md`
2. Read injected `runtime_context` before modifying files.
3. Use `runtime_context.task_context_files` as the first file-reading queue and `runtime_context.repo_context_summary` to orient quickly.
4. Prefer the injected `runtime_context.verification_plan` and `runtime_context.environment_snapshot` over ad hoc guesswork when choosing commands.
5. Stay within the assigned task scope.
6. Run the required local verification commands for the task.
7. Verification is part of task completion, not optional follow-up work.
8. Treat missing verification evidence as unfinished work instead of handing off `implementation_done` early.
9. Return explicit verification evidence in `commands_run`, `test_evidence`, and `test_results`.
10. Return structured output matching `.goose/recipes/shared/worker-output-schema.json`.
11. Do not claim global run completion; orchestrator-owned quality gates make final status decisions.

## Injected runtime context

Implementation recipes now receive a compact `runtime_context` object with:
- `repo_context_summary`
- `environment_snapshot`
- `task_context_files`
- `verification_plan`
- `time_budget_hint`

This context is intentionally compact and portable:
- repo/task context files are relative paths suitable for clones and worktrees
- environment data is a small repo-local snapshot, not a full machine dump
- verification guidance is advisory for the implementation task only

Workers should treat missing or conflicting injected context as a blocker, not as permission to invent orchestration policy.
Workers should also treat missing verification evidence as unfinished work, not as an acceptable candidate handoff.

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
