import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  FileBackedRunStore,
  ReportingManager,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

function buildRuntime(runId = 'run-runtime-event-schema') {
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), { runId });

  runtime.status = 'running';
  runtime.created_at = '2026-03-30T08:00:00.000Z';
  runtime.updated_at = '2026-03-30T08:00:00.000Z';
  runtime.storage_version = '1';
  runtime.graph.nodes = structuredClone(runtime.tasks);

  return runtime;
}

test('reporting manager records structured runtime event metadata alongside human-readable messages', () => {
  const runtime = buildRuntime('run-runtime-event-record');
  const task = runtime.tasks['task-api-contract'];
  task.retry_count = 1;
  task.status = 'pending';
  task.model = 'claude';
  task.model_metadata = {
    requested_model: 'claude',
    logical_model: 'claude',
    exact_model_id: 'anthropic/claude-opus-4-6',
    provider: 'anthropic',
    aliases: ['claude'],
  };

  const reportingManager = new ReportingManager();
  const event = reportingManager.record(
    runtime,
    'retry_scheduled',
    'Retry scheduled for task-api-contract after review feedback.',
    task.task_id,
    {
      failureCategory: 'quality_needs_fix',
      metadata: {
        next_model: 'claude',
        review_gate: 'review-agent',
        repeated_feedback: true,
      },
    },
  );

  assert.equal(event.phase, 'retry');
  assert.equal(event.attempt, 2);
  assert.equal(event.task_status, 'pending');
  assert.equal(event.failure_category, 'quality_needs_fix');
  assert.deepEqual(event.model, {
    selected_model: 'claude',
    logical_model: 'claude',
    exact_model_id: 'anthropic/claude-opus-4-6',
    provider: 'anthropic',
  });
  assert.deepEqual(event.metadata, {
    next_model: 'claude',
    review_gate: 'review-agent',
    repeated_feedback: true,
  });
  assert.equal(runtime.events.at(-1).message, event.message);
});

test('reporting manager does not infer failure categories for healthy task lifecycle events', () => {
  const runtime = buildRuntime('run-runtime-event-no-stale-failure-category');
  const task = runtime.tasks['task-api-contract'];
  task.status = 'pending';
  task.blocker_category = 'quality';
  task.blocker_message = 'Previous review feedback still needs changes.';

  const reportingManager = new ReportingManager();
  const event = reportingManager.record(
    runtime,
    'task_routed',
    'Dispatching task-api-contract to backend-agent on codex.',
    task.task_id,
  );

  assert.equal(event.phase, 'implementation');
  assert.equal(event.failure_category, null);
});

test('file-backed run store preserves structured runtime events and normalizes legacy event records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-event-schema-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-runtime-event-store');
    runtime.events = [
      {
        timestamp: '2026-03-30T08:00:00.000Z',
        type: 'runtime_initialized',
        message: 'Runtime initialized for epic demo.',
      },
      {
        timestamp: '2026-03-30T08:03:00.000Z',
        task_id: 'task-api-contract',
        type: 'retry_scheduled',
        message: 'Retry scheduled for task-api-contract after review feedback.',
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
          next_model: 'claude',
          review_gate: 'review-agent',
          repeated_feedback: true,
        },
      },
    ];

    const store = new FileBackedRunStore({ stateDir });
    await store.save(runtime);

    const loadedRuntime = await store.load(runtime.run_id);
    const loadedEvents = await store.loadEvents(runtime.run_id);

    assert.deepEqual(loadedRuntime.events[0], {
      timestamp: '2026-03-30T08:00:00.000Z',
      type: 'runtime_initialized',
      message: 'Runtime initialized for epic demo.',
      phase: 'orchestration',
      attempt: null,
      task_status: null,
      failure_category: null,
      model: null,
      metadata: {},
    });
    assert.deepEqual(loadedRuntime.events[1], runtime.events[1]);
    assert.deepEqual(loadedEvents, loadedRuntime.events);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
