# Strict Codex Review Rubric

## Purpose

This document defines the repository-standard rubric for strict local Codex review.

It is based on two OpenAI baselines:
- the official Codex SDK code review example
- the GPT-5-Codex prompting guidance that recommends minimal, high-signal prompts instead of over-prompting

This rubric should be the source of truth for repository-local `review-agent` prompt design and structured review output.

## OpenAI Baseline Rules

The official OpenAI code review example uses the following core rules:

1. Review a proposed code change made by another engineer.
2. Focus on issues that impact correctness, performance, security, maintainability, or developer experience.
3. Flag only actionable issues introduced by the pull request.
4. Keep each finding short, direct, and tied to the affected file and line range.
5. Prioritize severe issues and avoid nit-level comments unless they block understanding.
6. End with an overall correctness verdict plus concise justification and confidence.
7. Ensure file citations and line numbers are exactly correct.

These are the minimum acceptable rules for any Codex review prompt in this repository.

## Repository Strictness Extensions

To make review output stricter and more useful for orchestration, this repository adds the following rules on top of the OpenAI baseline.

### Finding threshold

Only report a finding when all of the following are true:
- the issue is introduced by the reviewed diff
- the issue is discrete and actionable
- the issue has plausible impact on correctness, security, data integrity, performance, maintainability, or developer workflow quality
- the issue does not depend on hidden assumptions the reviewer cannot justify from the code, diff, tests, or stated requirements
- the original author would likely fix it if the issue were stated clearly

### What not to report

Do not report:
- pure style nits
- formatting-only complaints
- speculative breakage without a demonstrated affected path
- historical issues not introduced by the current diff
- vague “could be cleaner” observations that do not meet the finding threshold

### Explanation style

Each finding should:
- explain why the issue is a problem, not just point at suspicious code
- state the scenario or condition where the issue appears
- remain short and direct
- avoid praise, hedging, or filler

### Severity discipline

Severity should be explicit and conservative:
- `P0`: release-blocking or universally broken behavior
- `P1`: urgent correctness or safety issue that should be fixed in the next cycle
- `P2`: meaningful bug or regression worth fixing soon
- `P3`: lower-severity but still actionable issue

If severity is unclear, prefer the lower defensible level.

When serialized in the strict JSON review schema, `priority` should use the string enum `P0` | `P1` | `P2` | `P3`.

### Output discipline

Structured output should always include:
- findings
- overall correctness verdict
- concise overall explanation
- confidence score
- explicit severity for each finding
- exact file path and tight line range for each finding

This structured payload describes successful model review output only.
Adapter-level outcomes such as `manual_review_required` for timeout/auth/process/schema failures live outside this schema and should not be forced through it.

Verdict discipline:
- when `findings` is empty, `overall_correctness` should be `patch is correct`
- when `findings` contains one or more items, `overall_correctness` should be `patch is incorrect`

If no finding meets the threshold, return zero findings instead of stretching for coverage.

## Prompt Design Rules

Following the GPT-5-Codex prompting guidance, keep review prompts minimal and high-signal.

That means:
- keep the stable rubric short
- avoid personality instructions or rhetorical padding
- separate repository policy from ephemeral review context
- use a strict output schema instead of verbose wording whenever possible
- scope the review to the relevant diff, changed files, and required context

The preferred prompt structure is:
1. short review role and quality bar
2. explicit finding threshold
3. explicit output requirements
4. repository-specific context appended after the stable rubric

## Recommended Structured Review Schema

The default strict schema should include:
- `findings[]`
  - `title`
  - `body`
  - `confidence_score`
  - `priority`
  - `code_location.absolute_file_path`
  - `code_location.line_range.start`
  - `code_location.line_range.end`
- `overall_correctness`
- `overall_explanation`
- `overall_confidence_score`

This shape stays close to the official OpenAI review example while adding repository-specific strictness.

## Operational Rules for Local Review

For local `codex exec` review:
- prefer reviewing the current diff against an explicit base branch or base SHA
- include changed files when available
- fail closed if explicit review scope is missing instead of widening to the whole repository
- require exact file/line references before publishing findings
- treat malformed output, parse errors, auth/runtime failures, and timeouts as review-infrastructure failures, not as clean reviews
- do not route review-infrastructure failures back into author-fixable repair loops
- persist review progress and final findings into repository runtime state so retries and postmortems remain explainable

## Source Notes

OpenAI source materials that informed this rubric:
- official Codex SDK code review example: actionable issues, exact file/line citations, overall verdict, structured output
  `https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk`
- GPT-5-Codex prompting guidance: “less is more” and over-prompting can reduce quality
  `https://cookbook.openai.com/examples/gpt-5-codex_prompting_guide`
