import test from 'node:test';
import assert from 'node:assert/strict';

import { ModelRouter, OpenClawModelResolver } from '../dist/index.js';

test('OpenClawModelResolver maps logical aliases to exact model ids', () => {
  const resolver = new OpenClawModelResolver();

  const claude = resolver.resolve('claude');
  const codex = resolver.resolve('codex');

  assert.equal(claude.logical_model, 'claude');
  assert.equal(claude.exact_model_id, 'anthropic/claude-opus-4-6');
  assert.equal(claude.provider, 'anthropic');
  assert.equal(codex.logical_model, 'codex');
  assert.equal(codex.exact_model_id, 'openai-codex/gpt-5.4');
  assert.equal(codex.provider, 'openai-codex');
});

test('model routing can resolve exact OpenClaw availability while preserving logical labels', () => {
  const router = new ModelRouter();
  const route = router.route('integration-planner', {
    availableModels: [
      'openai-codex/gpt-5.4',
      'google-gemini-cli/gemini-3.1-pro-preview',
    ],
  });

  assert.equal(route.selectedModel, 'gemini');
  assert.equal(route.selectedModelExactId, 'google-gemini-cli/gemini-3.1-pro-preview');
  assert.equal(route.selectedModelProvider, 'google-gemini-cli');
});

test('OpenClawModelResolver preserves exact ids when they are already provided', () => {
  const resolver = new OpenClawModelResolver();
  const resolved = resolver.resolve('anthropic/claude-opus-4-6');

  assert.equal(resolved.requested_model, 'anthropic/claude-opus-4-6');
  assert.equal(resolved.logical_model, 'claude');
  assert.equal(resolved.exact_model_id, 'anthropic/claude-opus-4-6');
  assert.equal(resolved.provider, 'anthropic');
});

test('routeNext skips exact-equivalent models when escalating retries', () => {
  const router = new ModelRouter([
    {
      role: 'backend-agent',
      preferredModels: ['codex', 'openai-codex/gpt-5.4', 'claude'],
    },
  ]);

  const nextRoute = router.routeNext('backend-agent', 'codex', {
    availableModels: [
      'openai-codex/gpt-5.4',
      'anthropic/claude-opus-4-6',
    ],
  });

  assert.ok(nextRoute);
  assert.equal(nextRoute.selectedModel, 'claude');
  assert.equal(nextRoute.selectedModelExactId, 'anthropic/claude-opus-4-6');
});
