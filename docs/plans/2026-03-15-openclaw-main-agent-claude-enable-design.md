# OpenClaw Main Agent Claude Capability Design

**Date:** 2026-03-15

## Goal

Enable the existing OpenClaw main agent to use a Claude-compatible provider without changing the global default model or introducing a second long-lived OpenClaw agent.

## Current State

- The OpenClaw main agent already has `openai-codex` and `google-gemini-cli` auth available.
- The default OpenClaw model remains `openai-codex/gpt-5.4`.
- On 2026-03-15, OpenClaw model discovery confirms these exact external model ids are available:
  - `anthropic/claude-opus-4-6`
  - `google-gemini-cli/gemini-3.1-pro-preview`
- The `multi-agent-coding-assistant` repository currently routes logical roles to model names, but execution is still handled by mock dispatchers rather than real provider adapters.

## Chosen Approach

Add Anthropic-compatible provider configuration to the OpenClaw main agent only:

1. Keep `agents.defaults.model.primary` unchanged.
2. Add `models.providers.anthropic` to the main OpenClaw config with:
   - third-party `baseUrl`
   - third-party API key
   - empty explicit `models` list so OpenClaw can continue using its built-in Anthropic model catalog
3. Add compatibility aliases in the main OpenClaw config:
   - `claude` -> `anthropic/claude-opus-4-6`
   - `gemini` -> `google-gemini-cli/gemini-3.1-pro-preview`
4. Do not create a second OpenClaw agent.
5. Do not wire the repository runtime to real Claude or Gemini execution yet; this change only prepares the host agent capability layer and compatibility mapping.

## Why This Approach

- It is the smallest change that gives the main agent Claude access.
- It avoids unnecessary routing and state complexity from introducing another always-on OpenClaw agent.
- It matches the repository's current architecture, where worker roles are logical runtime roles rather than registered OpenClaw agents.

## Risks

- The key is stored locally in config as plaintext for now.
- The repository runtime still needs a real execution bridge before logical worker roles can actually invoke Claude or Gemini end-to-end.

## Next Iteration

The next version should add a real execution bridge:

- route roles to `provider + model + executor`
- replace mock dispatchers with concrete executors
- implement at least `GeminiCliExecutor` and `ClaudeExecutor`
- carry exact model ids in runtime state instead of bare `claude` / `gemini` labels
- use `anthropic/claude-opus-4-6` and `google-gemini-cli/gemini-3.1-pro-preview` as the initial verified external targets
- persist provider/model/executor/session metadata for each attempt
- keep OpenClaw registered agents separate from runtime worker roles unless isolation is explicitly required
