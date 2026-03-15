# OpenClaw Main Agent Claude Capability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude-compatible provider capability to the existing OpenClaw main agent without changing the default model.

**Architecture:** Update the main OpenClaw config so Anthropic-compatible requests can resolve against the existing main agent. Keep the default model on Codex, add compatibility aliases for the runtime's legacy `claude` / `gemini` labels, and verify the Anthropic and Gemini providers become usable against the exact model ids `anthropic/claude-opus-4-6` and `google-gemini-cli/gemini-3.1-pro-preview`.

**Tech Stack:** OpenClaw CLI, OpenClaw JSON config, Anthropic-compatible HTTP endpoint

---

### Task 1: Record the design decision

**Files:**
- Create: `docs/plans/2026-03-15-openclaw-main-agent-claude-enable-design.md`

**Step 1: Confirm current host state**

Run: `openclaw models status --json`
Expected: only `openai-codex` and `google-gemini-cli` are configured before the change.

**Step 2: Save the design note**

Write the short design covering:
- why the main OpenClaw agent is the right capability boundary
- why no second long-lived OpenClaw agent is required
- why the repository runtime still needs a future execution bridge

**Step 3: Verify the repo stays clean enough for this small doc change**

Run: `git status --short`
Expected: only the new plan/design docs appear after creation.

### Task 2: Add Anthropic-compatible provider configuration

**Files:**
- Modify: `~/.openclaw/openclaw.json`

**Step 1: Add `models.providers.anthropic`**

Set:
- `baseUrl` to the third-party Anthropic-compatible endpoint
- `apiKey` to the provided key
- `models` to `[]`

**Step 2: Keep the default model unchanged**

Do not change:
- `agents.defaults.model.primary`

Expected retained value:
- `openai-codex/gpt-5.4`

**Step 3: Add compatibility aliases for runtime placeholder names**

Set:
- `claude` -> `anthropic/claude-opus-4-6`
- `gemini` -> `google-gemini-cli/gemini-3.1-pro-preview`

This preserves compatibility while the repository runtime still emits bare `claude` / `gemini` model names.

**Step 4: Validate config**

Run: `openclaw config validate`
Expected: `Config valid`

### Task 3: Verify provider availability and exact model ids

**Files:**
- Inspect: `~/.openclaw/openclaw.json`
- Inspect: `openclaw models status --json`

**Step 1: Check Anthropic catalog visibility**

Run: `openclaw models list --all --provider anthropic --plain`
Expected: Anthropic model ids are listed, including `anthropic/claude-opus-4-6`.

**Step 2: Check Gemini catalog visibility**

Run: `openclaw models list --all --provider google-gemini-cli --plain`
Expected: Gemini model ids are listed, including `google-gemini-cli/gemini-3.1-pro-preview`.

**Step 3: Check configured provider state and alias state**

Run: `openclaw models status --json`
Expected:
- Anthropic appears as an available provider source while the resolved default model remains Codex.
- `aliases.claude` resolves to `anthropic/claude-opus-4-6`.
- `aliases.gemini` resolves to `google-gemini-cli/gemini-3.1-pro-preview`.

**Step 4: Probe live Anthropic auth**

Run: `openclaw models status --probe --probe-provider anthropic --json`
Expected: success against the configured endpoint, returning `anthropic/claude-opus-4-6`.

**Step 5: Probe live Gemini auth**

Run: `openclaw models status --probe --probe-provider google-gemini-cli --json`
Expected: success against the configured OAuth session, returning `google-gemini-cli/gemini-3.1-pro-preview`.
