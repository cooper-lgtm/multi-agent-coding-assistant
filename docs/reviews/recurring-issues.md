# Recurring Review Issues

Use this document to capture high-frequency review failures in this repository.
If a pattern repeats, do not leave it only in review comments. Promote it into docs, tests, templates, or automation.

---

## 1. Planning and runtime drift
Common symptoms:
- planning docs or prompts imply behavior the runtime does not implement
- schemas changed but normalizers, validators, or tests did not
- new task fields appear in examples without being supported end-to-end

Suggested actions:
- update schema, runtime, examples, and tests together
- add or refresh design docs when a new invariant is introduced

---

## 2. Quality gates treated like planning owners
Common symptoms:
- `test-agent` or `review-agent` appears as a planned owner
- DAG design starts modeling quality roles as first-class implementation tasks
- review feedback ignores the implementation-owner boundary

Suggested actions:
- keep planning outputs implementation-only
- enforce quality-gate behavior in runtime tests and docs

---

## 3. Retry and escalation semantics drift
Common symptoms:
- `needs_fix`, `blocked`, and `failed` are collapsed into one error path
- retry handoff loses prior evidence or blocker metadata
- downstream dependency blocking changes without updated tests

Suggested actions:
- preserve status distinctions in docs and code
- add focused runtime tests when retry policy changes

---

## 4. Logical-model and exact-model metadata drift
Common symptoms:
- routing uses logical labels but runtime state drops exact model ids
- adapters return incomplete `model_metadata`
- escalation changes the model but not the recorded metadata

Suggested actions:
- update model-resolution tests together with adapter/runtime changes
- document catalog changes in repo docs or plan docs

---

## 5. Docs lag behind current contracts
Common symptoms:
- root docs describe an older architecture snapshot
- plan docs still imply old ownership or runtime states
- important decisions live only in PR text or chat

Suggested actions:
- update root docs in the same PR when architecture assumptions change
- distinguish current baseline from historical design snapshots

---

## 6. Task input is too vague
Common symptoms:
- "improve orchestration"
- "make planning smarter"
- "wire the adapter better"

Suggested actions:
- use `docs/templates/task-template.md`
- define scope, constraints, and validation before broad edits
