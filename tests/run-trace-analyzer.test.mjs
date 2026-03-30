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
    retry_events: 4,
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
      retry_count: 3,
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
  assert.match(markdown, /## Blocker Categories/);
  assert.match(markdown, /\| repository \| 3 \| task-ui-shell \|/);
  assert.match(markdown, /## Retry Hotspots/);
  assert.match(markdown, /\| task-api-contract \| 3 \| claude, gemini \| quality_needs_fix \|/);
  assert.match(markdown, /## Model-Linked Failure Hotspots/);
  assert.match(markdown, /\| codex \| repository \| 3 \| openai-codex\/gpt-5\.4 \|/);
});
