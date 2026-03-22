# Runtime Success Harness Delivery Roadmap

**Date:** 2026-03-22
**Purpose:** capture the next repository phase after PR9 so future sessions can continue from a repo-local plan focused on improving real task success rate.

## Roadmap Principles

1. Optimize for successful real task completion, not just architectural neatness.
2. Keep `main-orchestrator` as the only global controller.
3. Preserve the rule that planning outputs implementation tasks only.
4. Move more success-critical logic into orchestrator-owned runtime harnesses instead of static prose alone.
5. Require workers to demonstrate self-verification before external quality gates decide final completion.
6. Make retries and future harness changes driven by structured run evidence.

## Status Snapshot

PR1 through PR9 established the current foundation:
- orchestration kernel
- planning pipeline
- OpenClaw adapter layer
- goose-backed implementation dispatch
- persistence and resume
- approval controls
- budget/policy/safety controls
- evaluation coverage
- CLI entry points

That phase produced a coherent kernel.
The next phase is about turning that kernel into a stronger day-to-day work agent.

## Next Planned PR Sequence

### PR10 - Rich Context Injection
**Theme:** help workers start with the right local knowledge instead of rediscovering it ad hoc.

**Why this PR exists**
The current harness is explicit about ownership and recovery, but worker execution context is still comparatively thin. Real task success depends on injecting the right repo, file, tool, and verification context at dispatch time.

**Primary scope**
- add `execution_guidance` to planning/runtime task contracts
- add runtime context builder and local environment discovery
- thread richer context through worker contracts, OpenClaw envelopes, and goose recipe inputs
- upgrade frontend/backend prompts so they consume the injected context intentionally

**Expected outcome**
Implementation workers begin each task with compact, deterministic context about:
- what to read first
- what commands to use to verify
- what environment checks matter
- what "done" means for the task

### PR11 - Self-Verification Guardrails
**Theme:** prevent workers from stopping at the first plausible implementation.

**Why this PR exists**
Even with better context, workers can still write code, inspect it briefly, and stop too early. The harness needs an orchestrator-owned completion checklist before external quality gates run.

**Primary scope**
- add a runtime middleware seam
- add pre-completion checklist middleware
- continue a task when implementation is not yet self-verified
- require stronger verification evidence in worker outputs and prompts

**Expected outcome**
Workers are much less likely to hand back an unverified candidate result, and the harness can push them back into a build/verify/fix loop before external gates fire.

### PR12 - Retry Diagnosis and Loop Detection
**Theme:** make retries adaptive instead of repetitive.

**Why this PR exists**
Once a task fails, the next attempt should inherit a diagnosis, not just the raw previous output. The runtime should also detect repeated attempts that are clearly variations of the same broken path.

**Primary scope**
- add attempt-history support and retry diagnostics
- add loop-detection heuristics
- enrich retry handoff payloads with reconsideration guidance
- expose repeated-pattern signals in reporting

**Expected outcome**
Retries become meaningfully smarter and the system becomes better at escaping local failure loops.

### PR13 - Structured Trace Analysis and Feedback Loop
**Theme:** improve the outer loop for harness engineering inside this repository.

**Why this PR exists**
Persisted runs are useful, but future harness work will be much faster if the repository can summarize where and why runs fail.

**Primary scope**
- enrich structured runtime events
- add run-trace analyzer module and script
- document a repeatable eval/review workflow for harvested run data

**Expected outcome**
The repository gains a practical, repo-local way to analyze failure modes and decide the next harness changes from evidence.

## Success Metrics for This Phase

The phase should move the repository toward:
- fewer implementation attempts that reach `implementation_done` without clear verification evidence
- higher usefulness of retry handoffs
- fewer repeated attempts with the same blocker pattern
- better visibility into common runtime failure categories

## Notes on Sequencing

- PR10 should land before PR11 because checklist enforcement depends on richer context and expected verification commands.
- PR11 should land before PR12 because retry diagnostics are much more useful once the system distinguishes "stopped too early" from "verified and still failed".
- PR13 should land after PR10-PR12 so the analyzer has better structured data to inspect.

This sequence intentionally extends the current architecture rather than replacing it.

