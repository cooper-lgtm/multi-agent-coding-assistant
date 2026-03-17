import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  FileBackedRunStore,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

function buildRuntime(runId = 'run-persist') {
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), { runId });

  runtime.status = 'paused';
  runtime.created_at = '2026-03-16T09:00:00.000Z';
  runtime.updated_at = '2026-03-16T09:05:00.000Z';
  runtime.storage_version = '1';
  runtime.control = {
    pause_requested: true,
    cancel_requested: false,
  };
  runtime.tasks['task-api-contract'].status = 'completed';
  runtime.tasks['task-ui-shell'].status = 'pending';
  runtime.tasks['task-integration-wireup'].status = 'pending';
  runtime.graph.nodes = structuredClone(runtime.tasks);

  return runtime;
}

test('file-backed run store writes manifest runtime snapshot and event log artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-store-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-artifacts');
    const store = new FileBackedRunStore({ stateDir });

    await store.save(runtime);

    const runDir = path.join(stateDir, 'runs', runtime.run_id);
    const manifestPath = path.join(runDir, 'manifest.json');
    const runtimePath = path.join(runDir, 'runtime.json');
    const eventsPath = path.join(runDir, 'events.jsonl');

    await access(manifestPath);
    await access(runtimePath);
    await access(eventsPath);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const persistedRuntime = JSON.parse(await readFile(runtimePath, 'utf8'));
    const eventLines = (await readFile(eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(manifest.run_id, runtime.run_id);
    assert.equal(manifest.status, 'paused');
    assert.equal(manifest.planning_mode, runtime.graph.planning_mode);
    assert.equal(manifest.task_counts.completed, 1);
    assert.equal(manifest.task_counts.pending, 2);
    assert.equal(manifest.control.pause_requested, true);
    assert.equal(manifest.control.cancel_requested, false);
    assert.equal(persistedRuntime.run_id, runtime.run_id);
    assert.deepEqual(persistedRuntime.tasks, runtime.tasks);
    assert.equal(eventLines.length, runtime.events.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file-backed run store reloads saved runtime snapshots and inspection metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-store-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-roundtrip');
    runtime.events.push({
      timestamp: '2026-03-16T09:06:00.000Z',
      type: 'pause_requested',
      message: 'Pause requested for run-roundtrip.',
    });

    const store = new FileBackedRunStore({ stateDir });
    await store.save(runtime);

    const loadedRuntime = await store.load(runtime.run_id);
    const manifest = await store.loadManifest(runtime.run_id);
    const events = await store.loadEvents(runtime.run_id);
    const runs = await store.listRuns();

    assert.deepEqual(loadedRuntime, runtime);
    assert.equal(manifest.run_id, runtime.run_id);
    assert.equal(manifest.artifacts.runtime_snapshot, 'runtime.json');
    assert.equal(manifest.artifacts.event_log, 'events.jsonl');
    assert.equal(events.at(-1).type, 'pause_requested');
    assert.ok(runs.some((run) => run.run_id === runtime.run_id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('control requests patch manifest control without rewriting runtime snapshots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-store-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-control-race');
    runtime.control = {
      pause_requested: false,
      cancel_requested: false,
    };

    const store = new FileBackedRunStore({ stateDir });
    await store.save(runtime);
    const runtimePath = path.join(stateDir, 'runs', runtime.run_id, 'runtime.json');
    const snapshotBeforePause = await readFile(runtimePath, 'utf8');

    await store.requestPause(runtime.run_id);

    const snapshotAfterPause = await readFile(runtimePath, 'utf8');
    const loadedRuntime = await store.load(runtime.run_id);
    const manifest = await store.loadManifest(runtime.run_id);

    assert.equal(snapshotAfterPause, snapshotBeforePause);
    assert.equal(loadedRuntime.tasks['task-ui-shell'].status, 'pending');
    assert.equal(loadedRuntime.control.pause_requested, true);
    assert.equal(manifest.control.pause_requested, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('saving a stale runtime snapshot does not clear an already-requested control flag', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-store-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-control-merge');
    runtime.control = {
      pause_requested: false,
      cancel_requested: false,
    };

    const store = new FileBackedRunStore({ stateDir });
    await store.save(runtime);

    const staleRuntime = structuredClone(runtime);
    staleRuntime.events.push({
      timestamp: '2026-03-16T09:07:00.000Z',
      type: 'stale_save_attempted',
      message: 'A stale snapshot attempted to persist after pause was requested.',
    });

    await store.requestPause(runtime.run_id);
    await store.save(staleRuntime);

    const loadedRuntime = await store.load(runtime.run_id);
    const manifest = await store.loadManifest(runtime.run_id);

    assert.equal(loadedRuntime.control.pause_requested, true);
    assert.equal(manifest.control.pause_requested, true);
    assert.equal(loadedRuntime.events.at(-1).type, 'stale_save_attempted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('approving a run preserves pause and cancel requests already recorded in the manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-store-'));
  const stateDir = path.join(root, 'state');

  try {
    const runtime = buildRuntime('run-approval-control-merge');
    runtime.control = {
      pause_requested: false,
      cancel_requested: false,
    };

    const store = new FileBackedRunStore({ stateDir });
    await store.save(runtime);
    await store.requestPause(runtime.run_id);
    await store.requestCancel(runtime.run_id);
    await store.approveRun(runtime.run_id, { approved_by: 'human-reviewer' });

    const loadedRuntime = await store.load(runtime.run_id);
    const manifest = await store.loadManifest(runtime.run_id);

    assert.equal(loadedRuntime.control.pause_requested, true);
    assert.equal(loadedRuntime.control.cancel_requested, true);
    assert.equal(manifest.control.pause_requested, true);
    assert.equal(manifest.control.cancel_requested, true);
    assert.equal(loadedRuntime.approval_state?.status, 'approved');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
