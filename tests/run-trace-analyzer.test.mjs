import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as library from '../dist/index.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'runtime-traces',
  'sample-run-events.json',
);

function loadSampleEvents() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

test('run trace analyzer summarizes blocker categories, continuation signals, retry hotspots, and model-linked failures', () => {
  assert.equal(typeof library.analyzeRunTraces, 'function');

  const analysis = library.analyzeRunTraces([
    {
      source_id: 'sample-run-events',
      events: loadSampleEvents(),
    },
  ]);

  assert.deepEqual(analysis.totals, {
    source_count: 1,
    event_count: 9,
    checklist_continuations: 1,
    retry_loop_signals: 1,
    retry_events: 3,
    negative_terminal_events: 3,
  });

  assert.deepEqual(analysis.blocker_categories, [
    {
      category: 'repository',
      count: 3,
      source_ids: ['sample-run-events'],
      task_ids: ['task-ui-shell'],
    },
    {
      category: 'quality',
      count: 1,
      source_ids: ['sample-run-events'],
      task_ids: ['task-integration-wireup'],
    },
  ]);

  assert.deepEqual(analysis.retry_hotspots, [
    {
      task_id: 'task-api-contract',
      retry_count: 2,
      failure_categories: ['quality_needs_fix'],
      models: ['claude', 'gemini'],
    },
    {
      task_id: 'task-ui-shell',
      retry_count: 1,
      failure_categories: ['repository'],
      models: ['codex'],
    },
  ]);

  assert.deepEqual(analysis.model_failure_hotspots.slice(0, 4), [
    {
      selected_model: 'codex',
      logical_model: 'codex',
      exact_model_id: 'openai-codex/gpt-5.4',
      provider: 'openai-codex',
      failure_category: 'repository',
      count: 3,
    },
    {
      selected_model: 'claude',
      logical_model: 'claude',
      exact_model_id: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      failure_category: 'quality_needs_fix',
      count: 2,
    },
    {
      selected_model: 'claude',
      logical_model: 'claude',
      exact_model_id: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      failure_category: 'quality',
      count: 1,
    },
    {
      selected_model: 'codex',
      logical_model: 'codex',
      exact_model_id: 'openai-codex/gpt-5.4',
      provider: 'openai-codex',
      failure_category: 'verification_incomplete',
      count: 1,
    },
  ]);
});

test('run trace analyzer does not attribute retry_scheduled failures to the next selected model', () => {
  const analysis = library.analyzeRunTraces([
    {
      source_id: 'retry-attribution',
      events: [
        {
          timestamp: '2026-03-31T00:00:00.000Z',
          task_id: 'task-api-contract',
          type: 'retry_scheduled',
          message: 'Retry escalation for task-api-contract: retry 2 will use gemini.',
          phase: 'retry',
          attempt: 3,
          task_status: 'pending',
          failure_category: 'quality_needs_fix',
          model: {
            selected_model: 'gemini',
            logical_model: 'gemini',
            exact_model_id: 'google-gemini-cli/gemini-3.1-pro-preview',
            provider: 'google-gemini-cli',
          },
          metadata: {
            retry_action: 'retry_with_upgraded_model',
            next_model: 'gemini',
          },
        },
        {
          timestamp: '2026-03-31T00:01:00.000Z',
          task_id: 'task-api-contract',
          type: 'retry_loop_detected',
          message: 'Retry loop detected for task-api-contract.',
          phase: 'retry',
          attempt: 3,
          task_status: 'needs_fix',
          failure_category: 'quality_needs_fix',
          model: {
            selected_model: 'claude',
            logical_model: 'claude',
            exact_model_id: 'anthropic/claude-opus-4-6',
            provider: 'anthropic',
          },
          metadata: {
            loop_detected: true,
          },
        },
      ],
    },
  ]);

  assert.deepEqual(analysis.model_failure_hotspots, [
    {
      selected_model: 'claude',
      logical_model: 'claude',
      exact_model_id: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      failure_category: 'quality_needs_fix',
      count: 1,
    },
  ]);
});

test('run trace analyzer keeps same-model retries in model hotspot attribution', () => {
  const analysis = library.analyzeRunTraces([
    {
      source_id: 'retry-same-model-attribution',
      events: [
        {
          timestamp: '2026-03-31T00:00:00.000Z',
          task_id: 'task-api-contract',
          type: 'retry_scheduled',
          message: 'Retry scheduled for task-api-contract: retry 2 will reuse claude.',
          phase: 'retry',
          attempt: 2,
          task_status: 'pending',
          failure_category: 'quality_needs_fix',
          model: {
            selected_model: 'claude',
            logical_model: 'claude',
            exact_model_id: 'anthropic/claude-opus-4-6',
            provider: 'anthropic',
          },
          metadata: {
            retry_action: 'retry_same_model',
            next_model: 'claude',
          },
        },
      ],
    },
  ]);

  assert.deepEqual(analysis.model_failure_hotspots, [
    {
      selected_model: 'claude',
      logical_model: 'claude',
      exact_model_id: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      failure_category: 'quality_needs_fix',
      count: 1,
    },
  ]);
});

test('run trace analyzer ignores retry-phase blocking events when counting retry hotspots', () => {
  const analysis = library.analyzeRunTraces([
    {
      source_id: 'retry-hotspot-filtering',
      events: [
        {
          timestamp: '2026-03-31T00:00:00.000Z',
          task_id: 'task-ui-shell',
          type: 'task_blocked_by_dependency',
          message: 'Task task-ui-shell is blocked by dependency task-api-contract.',
          phase: 'retry',
          attempt: 1,
          task_status: 'blocked',
          failure_category: 'dependency',
          model: {
            selected_model: 'codex',
            logical_model: 'codex',
            exact_model_id: 'openai-codex/gpt-5.4',
            provider: 'openai-codex',
          },
          metadata: {
            blocker_category: 'dependency',
          },
        },
      ],
    },
  ]);

  assert.equal(analysis.totals.retry_events, 0);
  assert.deepEqual(analysis.retry_hotspots, []);
});

test('run trace analyzer renders a stable markdown summary for CLI output', () => {
  assert.equal(typeof library.analyzeRunTraces, 'function');
  assert.equal(typeof library.renderRunTraceAnalysis, 'function');

  const analysis = library.analyzeRunTraces([
    {
      source_id: 'sample-run-events',
      events: loadSampleEvents(),
    },
  ]);
  const markdown = library.renderRunTraceAnalysis(analysis);

  assert.match(markdown, /^# Run Trace Analysis/m);
  assert.match(markdown, /- Sources analyzed: 1/);
  assert.match(markdown, /- Checklist continuations: 1/);
  assert.match(markdown, /- Retry loop signals: 1/);
  assert.match(markdown, /- Retry events: 3/);
  assert.match(markdown, /## Blocker Categories/);
  assert.match(markdown, /\| repository \| 3 \| task-ui-shell \|/);
  assert.match(markdown, /## Retry Hotspots/);
  assert.match(markdown, /\| task-api-contract \| 2 \| claude, gemini \| quality_needs_fix \|/);
  assert.match(markdown, /## Model-Linked Failure Hotspots/);
  assert.match(markdown, /\| codex \| repository \| 3 \| openai-codex\/gpt-5\.4 \|/);
  assert.match(markdown, /\| claude \| quality_needs_fix \| 2 \| anthropic\/claude-opus-4-6 \|/);
});
