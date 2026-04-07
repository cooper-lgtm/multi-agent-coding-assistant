# First-Blocked-Push Review-Gate Mechanism Design

**Status:** Proposed

**Related Plan:** `docs/plans/2026-04-07-review-gate-first-blocked-push-mechanism.md`

## Background

The repository now has a cleaner planning baseline for review-gate policy, but a
fresh docs-only execution branch still exposed a deeper problem: on the first
push, the blocking local review gate can return `findings` before a branch has a
published PR or any durable review-decision artifact.

That creates dead-end cases for:
- false-positive findings that should be `reject_with_evidence`
- real out-of-scope findings that should be `defer_with_follow_up`
- infrastructure failures that must stay fail-closed as
  `manual_review_required`

The current docs-only policy intentionally keeps this problem out of scope. This
design defines the separate mechanism work needed to resolve it cleanly.

## Decision

Treat first-blocked-push handling as a dedicated review-gate mechanism, not as a
docs-only policy concern.

The mechanism must separate:
- the review result itself
- the branch publication path
- the author-side workflow
- the maintainer-side override or approval workflow

## Design Goals

1. Preserve fail-closed behavior for infrastructure failures.
2. Allow false-positive findings to be rejected with durable evidence.
3. Allow real out-of-scope findings to be deferred with durable follow-up.
4. Avoid turning the mechanism into a broad bypass for review findings.
5. Keep author-side and maintainer-side powers explicit and auditable.

## Non-goals

- redesign the whole local review rubric
- weaken the review gate for normal in-scope correctness findings
- invent new product-level runtime states unrelated to the review gate
- solve unrelated CI or GitHub review automation issues in the same change

## Core Problem Statement

Today the repository blocks `git push` on returned `findings`.

That means a branch can receive a review outcome before it has:
- a published PR
- a checked-in review decision artifact
- a maintainer-visible audit trail beyond terminal output

As a result:
- `reject_with_evidence` is logically valid but cannot always be published
- `defer_with_follow_up` is logically valid but may have nowhere durable to land
- `manual_review_required` must remain fail-closed and should never be confused
  with an author-level review decision

## Design Options

### Option A: Maintainer-owned override path with durable reviewed artifact

Authors still hit the blocking local gate on first push. When the result is a
false positive or an out-of-scope finding, a maintainer uses a separate trusted
path to publish the branch plus a durable review-decision artifact.

**Pros:**
- strongest trust boundary
- fail-closed by default
- clear audit trail

**Cons:**
- slower for contributors
- requires maintainer intervention

### Option B: Author-visible decision artifact with signed or trusted replay

The first blocked push produces a local machine-readable artifact that an author
can check in through a constrained path, and the runner re-evaluates it on the
next attempt.

**Pros:**
- less maintainer toil
- more direct author workflow

**Cons:**
- harder trust model
- greater risk of becoming a general bypass

### Option C: Split review into advisory first pass and blocking second pass

The first push publishes the branch but marks the local review result as pending
blocking adjudication; later pushes or merge gates enforce the final decision.

**Pros:**
- removes the first-push deadlock
- simpler author ergonomics

**Cons:**
- meaningfully changes current review-gate behavior
- higher workflow and policy risk

## Recommended Direction

Choose **Option A** first.

It best preserves the current fail-closed semantics while introducing the
smallest explicit trust boundary: first-push false-positive and deferral cases
need maintainer-backed publication and a durable reviewed artifact.

## Required Responsibilities

### Author responsibilities

- attempt the normal push path first
- capture the blocking review output
- prepare evidence or follow-up context locally
- do not bypass the hook or runner directly

### Maintainer responsibilities

- review the claimed false positive or out-of-scope finding
- decide whether to reject, defer, or require same-PR fix
- publish or approve the branch only through the trusted mechanism
- ensure a durable audit artifact exists

### Runner responsibilities

- keep normal findings blocking by default
- distinguish infra failure from substantive review outcomes
- consume only trusted mechanism inputs
- record the final decision path in a durable form

## Artifact Requirements

Any mechanism proposal should define a durable record for exceptional cases with
at least:
- finding fingerprint or exact file or line reference
- review command and scope
- decision (`reject_with_evidence` or `defer_with_follow_up`)
- rationale
- evidence or follow-up pointer
- reviewer or approver identity
- timestamp

`manual_review_required` must never be stored as an author decision. It should
remain a process failure or escalation record.

## Security and Abuse Risks

- authors smuggling same-PR correctness bugs through a false-positive claim
- generalized bypass behavior leaking beyond narrow first-blocked-push cases
- stale or spoofed decision artifacts
- maintainer approvals without enough evidence

## Trigger to Proceed

Open implementation work only after agreeing on:
- who can create or approve exceptional publication paths
- where the durable decision artifact lives
- whether the trusted mechanism lives in the hook, runner, or a separate
  maintainer tool
- how infra failures remain fail-closed
