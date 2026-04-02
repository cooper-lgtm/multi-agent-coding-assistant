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

## 4. Low-yield retry loops go unchallenged
Common symptoms:
- consecutive retries touch the same files with the same blocker or review feedback
- retry history only preserves one shallow summary, so repeated patterns stay invisible
- model escalation happens without an explicit change in strategy or verification evidence

Suggested actions:
- preserve bounded attempt history plus structured diagnosis on the runtime task
- let orchestrator-owned middleware attach reconsideration guidance before the next dispatch
- refresh runtime goldens and reporting assertions when retry-loop events or diagnosis strings change
- run `npm run analyze:traces -- --state-dir state` after repeated failures so the same loop is visible in repo-local summaries, not only in one PR discussion

---

## 5. Logical-model and exact-model metadata drift
Common symptoms:
- routing uses logical labels but runtime state drops exact model ids
- adapters return incomplete `model_metadata`
- escalation changes the model but not the recorded metadata

Suggested actions:
- update model-resolution tests together with adapter/runtime changes
- document catalog changes in repo docs or plan docs

---

## 6. Docs lag behind current contracts
Common symptoms:
- root docs describe an older architecture snapshot
- plan docs still imply old ownership or runtime states
- important decisions live only in PR text or chat

Suggested actions:
- update root docs in the same PR when architecture assumptions change
- distinguish current baseline from historical design snapshots

---

## 7. Task input is too vague
Common symptoms:
- "improve orchestration"
- "make planning smarter"
- "wire the adapter better"

Suggested actions:
- use `docs/templates/task-template.md`
- define scope, constraints, and validation before broad edits

---

## 8. Behavior changes bypass test-first flow
Common symptoms:
- implementation starts before a narrow failing test exists
- plans describe broad code edits but do not name the first failing test target
- validation jumps straight to broad suites without confirming the intended red-to-green behavior first
- exceptions such as doc-only work are implied but never stated

Suggested actions:
- name the first failing test target and narrow command in the task plan when behavior changes
- confirm the first failure is the expected one before implementing the fix or feature
- implement the smallest change that turns that test green before running broader validation
- state explicit exceptions when the task is doc-only, config-only with no behavior impact, or another narrow non-TDD case

---

## 9. Premature backward-compatibility pressure
Common symptoms:
- review feedback asks for compatibility with runtime snapshots, worker payloads, or event records that have never shipped
- a PR starts adding fallback parsing for hypothetical older formats without a stated migration requirement
- compatibility arguments override clearer current contracts during active MVP development

Suggested actions:
- check whether the task explicitly requires migration or legacy support before changing current contracts
- prefer current correctness, recoverability, and traceable schema updates when no shipped artifact depends on the old shape
- if compatibility is required, document the supported legacy source and add focused regression coverage

---

## 10. Trace findings stay trapped in chat
Common symptoms:
- repeated blocker categories or verification failures show up in persisted runs, but nobody writes them back into docs
- retry hotspots are only discussed in one review thread instead of becoming reusable repository guidance
- analyzer output is treated as automatically authoritative rather than a prompt to inspect code and plans

Suggested actions:
- run `npm run analyze:traces -- --state-dir state` after noisy runs or before proposing another harness change
- summarize stable findings in `docs/reviews/recurring-issues.md`, `docs/context/repo-context.*`, or a fresh plan doc
- keep the analyzer read-only and require a human decision before changing prompts, policies, or roadmap priorities
