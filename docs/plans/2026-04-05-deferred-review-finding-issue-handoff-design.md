# Deferred Review Finding Issue Handoff Design

**Date:** 2026-04-05

## Goal

Design a repository-owned handoff model for review findings that are confirmed
real and require code changes, but should not be fixed in the current pull
request.

## Background

This repository already has a strict local review gate and a strong distinction
between:

- actionable review findings introduced by the reviewed diff
- review infrastructure failures such as `manual_review_required`

That distinction must remain intact. The current gap is not detection. The gap
is follow-up handling when a finding really should be fixed, but not in the
current PR.

The user also wants this design to remain valid even if Goose is replaced
later. That means the design cannot depend on Goose recipes, GitHub issues, or
review-provider-specific behavior as the system of record.

## Problem Statement

Today there is no stable repository contract for:

- triaging a confirmed finding into “fix now” versus “follow up later”
- recording the finding in a durable, reviewable, agent-readable form
- avoiding stale or duplicate follow-up records when heads rebase, amend, or
  merge
- projecting that record into a GitHub issue without making the issue itself
  the source of truth

If this is solved too loosely, the repository risks two failure modes:

1. unresolved findings get silently waived because an issue exists
2. follow-up tracking becomes stale because pre-merge findings are treated as
   durable before the reviewed head is stable

## Constraints

- keep the current fail-closed review and merge semantics
- keep `review-agent` as detector only
- keep triage as the decision owner for defer, carry-forward, resolution, and
  follow-up
- keep `manual_review_required` outside the deferred code-fix lane
- keep the first implementation slice docs-only
- avoid baking Goose or GitHub behavior into the canonical contract

## Chosen Design

### 1. Separate detection from triage

The review provider detects findings. It does not decide whether a finding
should become deferred follow-up work.

Triage owns:

- confirmation that the finding is real and actionable
- merge-state classification
- carry-forward and supersession decisions
- resolution and discard decisions
- whether a durable follow-up issue should exist

### 2. Canonical record model

The source of truth is a repo-owned `deferred_fix_handoff` ledger/artifact.
Issues, PR comments, and task docs are projections only.

Each ledger entry must include:

- `ledger_entry_id`
  - a stable opaque identifier minted by triage at the first canonical write
- `status`
  - `provisional | confirmed | carried_forward | resolved | discarded`
- `origin_phase`
  - `pre_merge_current_head | post_merge`
- `head_context`
  - `repo`
  - `base_ref`
  - `head_ref`
  - `head_sha`
  - `head_relationship: current | superseded`
- `raw_provenance`
  - reviewer run id or version
  - source review artifact id
  - source review artifact URL when available
  - raw detector summary or body snapshot
  - finding source location
  - timestamp
  - actor or system that recorded the raw review
  - linked PR or commit context when available
- `deferred_fix_handoff`
  - problem summary
  - affected code scope
  - why the fix is deferred
  - recommended follow-up action
  - severity or priority when present
  - evidence links
  - triage decision metadata
- `fingerprint`
  - optional metadata for search or dedupe hints only

Important rule:

- `fingerprint` is not identity
- `fingerprint` is never the record key
- `fingerprint` is never enough by itself for carry-forward, closure, or
  projection reconciliation

### 3. Lifecycle and state machine

| State | Owner | Entry Criteria | Exit Criteria | Allowed Transitions |
| --- | --- | --- | --- | --- |
| `provisional` | triage | finding detected on `pre_merge_current_head`; not yet durable | post-merge confirmation, explicit carry-forward, or discard | `confirmed`, `carried_forward`, `discarded` |
| `confirmed` | triage | finding durably re-observed or adopted after `post_merge` | resolved, discarded, or rewritten into carried-forward work | `resolved`, `discarded`, `carried_forward` |
| `carried_forward` | triage | provisional or confirmed finding explicitly preserved across a head change or follow-up reframe | resolved or discarded | `resolved`, `discarded` |
| `resolved` | triage | fix landed or triage explicitly verified no remaining work is needed | reopened only with new evidence | `confirmed`, `carried_forward` |
| `discarded` | triage | false positive, obsolete due to code change, or intentionally not pursued | reopened only with new evidence and new triage action | `confirmed`, `carried_forward` |

### 4. Merge-state behavior

#### `pre_merge_current_head`

- a finding may enter only as `provisional`
- no durable follow-up issue is created automatically
- tracking alone is not enough to unblock the PR

#### `post_merge`

- triage may promote a surviving finding to `confirmed`
- only then may durable follow-up work activate

#### `superseded_head`

- a provisional record does not survive automatically
- triage must either:
  - mark it `carried_forward`
  - or mark it `discarded`

### 5. Activation rule

A finding becomes durable actionable follow-up only if all of the following are
true:

- the finding is confirmed real
- the finding requires code changes
- triage explicitly chooses defer or follow-up
- the case is not `manual_review_required`
- either:
  - `origin_phase = post_merge`
  - or triage explicitly carries the finding forward on the current head

Plain `pre_merge_current_head` is never enough to activate durable follow-up by
itself.

### 6. Projection reconciliation

GitHub issues are projections of the canonical ledger.

| Canonical State/Event | Issue Projection Action | Idempotency Expectation |
| --- | --- | --- |
| first durable `confirmed` or `carried_forward` with no open projection | `create` | repeated reconciliation no-ops when an equivalent open projection is already linked |
| canonical metadata changes while the same ledger entry remains active | `update` | repeated update with identical content no-ops |
| canonical `resolved` or `discarded` with open projection | `close` | repeated close no-ops |
| canonical record reactivated from `resolved` or `discarded` | `reopen` | repeated reopen no-ops if already open |
| `provisional` only, without post-merge confirmation or explicit carry-forward | `no-op` | never creates durable issue projection |
| projection drift while canonical is unchanged | `update` to canonical truth | repeated reconciliation converges without duplicate side effects |

Rules:

- reconciliation is keyed by `ledger_entry_id`
- issues may show `fingerprint` for operator convenience
- issues never become the authority for lifecycle transitions

### 7. Repeated infrastructure failures

`manual_review_required` is never part of the deferred code-fix lane.

If repeated infrastructure failures need tracking, they belong in a separate
ops-tracking workflow, not in `deferred_fix_handoff`.

## Alternatives Considered And Rejected

### Reviewer-owned defer decisions

Rejected because detection and triage must stay separate.

### Issue tracker as canonical store

Rejected because issue systems are projections and cannot safely own full
provenance, lifecycle, and carry-forward authority.

### Fingerprint as identity

Rejected because title churn, line movement, and provider wording make it too
unstable.

### Auto-activating pre-merge findings

Rejected because `pre_merge_current_head` is provisional by design.

### Allowing `manual_review_required` into deferred code-fix handoff

Rejected because infrastructure failures need a separate ops path.

## Non-goals

This design does not:

- change runner or merge behavior in Phase 1
- add new review gate statuses
- allow issues to waive blocking findings
- define provider-specific GitHub automation in the core contract
- solve duplicate or stale records by fingerprint alone

## Success Criteria

The design is successful when:

- the canonical ledger is explicitly defined as the source of truth
- `ledger_entry_id`, provenance, and minimum handoff payload are specified
- lifecycle transitions are explicit
- `pre_merge_current_head`, `post_merge`, and `superseded_head` are handled
  differently and intentionally
- issue projections are clearly subordinate to the ledger
- `manual_review_required` is explicitly excluded

## Verification

Phase 1 verification is doc-based, not runner-based.

The written design should include worked examples for:

- a `provisional` record that becomes `discarded`
- a merged finding that becomes `confirmed`
- a superseded-head finding that becomes `carried_forward`
- a later fix that closes the projection
- a regression that reopens the projection
- `manual_review_required` exclusion
