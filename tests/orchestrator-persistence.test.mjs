import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MainOrchestrator,
  ReportingManager,
  RetryEscalationManager,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

function buildRuntime(runId) {
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), { runId });

  runtime.status = 'running';
  runtime.created_at = '2026-03-16T10:00:00.000Z';
  runtime.updated_at = '2026-03-16T10:00:00.000Z';
  runtime.storage_version = '1';
  runtime.control = {
    pause_requested: false,
    cancel_requested: false,
  };
  runtime.graph.nodes = structuredClone(runtime.tasks);

  return runtime;
}

function buildRequest() {
  return {
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
  };
}

class ControlledRunStore {
  constructor(initialRuntime = null) {
    this.runtimes = new Map();

    if (initialRuntime) {
      this.runtimes.set(initialRuntime.run_id, structuredClone(initialRuntime));
    }
  }

  async save(runtime) {
    const snapshot = structuredClone(runtime);
    this.runtimes.set(runtime.run_id, snapshot);
  }

  async load(runId) {
    const runtime = this.runtimes.get(runId);
    return runtime ? structuredClone(runtime) : null;
  }

  async listRuns() {
    return [...this.runtimes.values()].map((runtime) => ({
      run_id: runtime.run_id,
      status: runtime.status,
      control: structuredClone(runtime.control),
    }));
  }

  async loadManifest(runId) {
    const runtime = await this.load(runId);
    if (!runtime) return null;

    return {
      run_id: runtime.run_id,
      status: runtime.status,
      control: structuredClone(runtime.control),
      task_counts: {
        completed: Object.values(runtime.tasks).filter((task) => task.status === 'completed').length,
        pending: Object.values(runtime.tasks).filter((task) => task.status === 'pending').length,
        cancelled: Object.values(runtime.tasks).filter((task) => task.status === 'cancelled').length,
      },
    };
  }

  async loadEvents(runId) {
    const runtime = await this.load(runId);
    return runtime ? structuredClone(runtime.events) : [];
  }

  async requestPause(runId) {
    const runtime = this.runtimes.get(runId);
    if (!runtime) throw new Error(`Unknown run: ${runId}`);
    runtime.control = {
      pause_requested: runtime.control?.pause_requested ?? false,
      cancel_requested: runtime.control?.cancel_requested ?? false,
    };
    runtime.control.pause_requested = true;
  }

  async requestCancel(runId) {
    const runtime = this.runtimes.get(runId);
    if (!runtime) throw new Error(`Unknown run: ${runId}`);
    runtime.control = {
      pause_requested: runtime.control?.pause_requested ?? false,
      cancel_requested: runtime.control?.cancel_requested ?? false,
    };
    runtime.control.cancel_requested = true;
  }
}

class CountingImplementationDispatcher {
  constructor(options = {}) {
    this.calls = [];
    this.forbiddenTaskIds = new Set(options.forbiddenTaskIds ?? []);
    this.onDispatch = options.onDispatch ?? null;
  }

  async dispatch(task, runtime) {
    if (this.forbiddenTaskIds.has(task.task_id)) {
      throw new Error(`Implementation should not rerun for ${task.task_id}`);
    }

    this.calls.push(task.task_id);

    if (this.onDispatch) {
      await this.onDispatch(task, runtime);
    }

    return {
      taskId: task.task_id,
      role: task.assigned_agent,
      status: 'implementation_done',
      summary: `Implementation completed for ${task.task_id}.`,
      changed_files: [`src/mock/${task.task_id}.ts`],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: [`Implementation completed for ${task.task_id}.`],
      test_evidence: [],
      review_feedback: [],
      prior_attempt: task.prior_attempt ?? null,
    };
  }
}

class CountingQualityGateRunner {
  constructor() {
    this.calls = [];
  }

  async run(task) {
    this.calls.push(task.task_id);

    return {
      taskId: task.task_id,
      roles: ['test-agent', 'review-agent'],
      status: 'completed',
      summary: `Quality gates passed for ${task.task_id}.`,
      changed_files: [...task.changed_files],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: [...task.implementation_evidence],
      test_evidence: [`test-agent passed for ${task.task_id}.`],
      review_feedback: [`review-agent approved ${task.task_id}.`],
      prior_attempt: task.prior_attempt ?? null,
      test_status: 'pass',
      review_status: 'approved',
      test_model: 'codex',
      review_model: 'claude',
    };
  }
}

test('resume continues from an implementation checkpoint without restarting finished implementation work', async () => {
  const runtime = buildRuntime('run-resume-checkpoint');
  runtime.tasks['task-api-contract'].status = 'implementation_done';
  runtime.tasks['task-api-contract'].changed_files = ['src/mock/task-api-contract.ts'];
  runtime.tasks['task-api-contract'].implementation_evidence = ['Recovered persisted implementation output.'];
  runtime.graph.nodes = structuredClone(runtime.tasks);

  const runStore = new ControlledRunStore(runtime);
  const dispatcher = new CountingImplementationDispatcher({
    forbiddenTaskIds: ['task-api-contract'],
  });
  const qualityGateRunner = new CountingQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => {
      throw new Error('resume should not re-run planning');
    },
    implementationDispatcher: dispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.resume(runtime.run_id);

  assert.deepEqual(dispatcher.calls, ['task-ui-shell', 'task-integration-wireup']);
  assert.deepEqual(qualityGateRunner.calls, [
    'task-api-contract',
    'task-ui-shell',
    'task-integration-wireup',
  ]);
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'completed');
  assert.equal(result.summary.final_status, 'completed');
});

test('resume continues a paused run from its last checkpoint', async () => {
  const runtime = buildRuntime('run-resume-paused');
  runtime.status = 'paused';
  runtime.control.pause_requested = true;
  runtime.tasks['task-api-contract'].status = 'implementation_done';
  runtime.tasks['task-api-contract'].changed_files = ['src/mock/task-api-contract.ts'];
  runtime.tasks['task-api-contract'].implementation_evidence = ['Checkpointed implementation output.'];
  runtime.graph.nodes = structuredClone(runtime.tasks);

  const runStore = new ControlledRunStore(runtime);
  const dispatcher = new CountingImplementationDispatcher({
    forbiddenTaskIds: ['task-api-contract'],
  });
  const qualityGateRunner = new CountingQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => {
      throw new Error('resume should not re-run planning');
    },
    implementationDispatcher: dispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.resume(runtime.run_id);

  assert.deepEqual(qualityGateRunner.calls, [
    'task-api-contract',
    'task-ui-shell',
    'task-integration-wireup',
  ]);
  assert.equal(result.runtime.control.pause_requested, false);
  assert.equal(result.runtime.status, 'completed');
  assert.equal(result.summary.final_status, 'completed');
});

test('resume normalizes transient in-flight task states back to pending before scheduling again', async () => {
  const runtime = buildRuntime('run-resume-normalize');
  runtime.tasks['task-api-contract'].status = 'completed';
  runtime.tasks['task-ui-shell'].status = 'running';
  runtime.tasks['task-ui-shell'].error = 'Worker exited mid-dispatch.';
  runtime.graph.nodes = structuredClone(runtime.tasks);

  const runStore = new ControlledRunStore(runtime);
  const dispatcher = new CountingImplementationDispatcher();
  const qualityGateRunner = new CountingQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => {
      throw new Error('resume should not re-run planning');
    },
    implementationDispatcher: dispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.resume(runtime.run_id);

  assert.deepEqual(dispatcher.calls, ['task-ui-shell', 'task-integration-wireup']);
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'completed');
  assert.equal(result.runtime.tasks['task-ui-shell'].error, null);
  assert.equal(result.summary.final_status, 'completed');
});

test('pause requests stop new scheduling at the next safe checkpoint and mark the run paused', async () => {
  const runStore = new ControlledRunStore();
  const dispatcher = new CountingImplementationDispatcher({
    onDispatch: async (task, runtime) => {
      if (task.task_id === 'task-api-contract') {
        await runStore.requestPause(runtime.run_id);
      }
    },
  });
  const qualityGateRunner = new CountingQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: dispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run(buildRequest());

  assert.deepEqual(dispatcher.calls, ['task-api-contract']);
  assert.deepEqual(qualityGateRunner.calls, []);
  assert.equal(result.runtime.status, 'paused');
  assert.equal(result.runtime.control.pause_requested, true);
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'implementation_done');
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'pending');
  assert.equal(result.summary.final_status, 'paused');
});

test('cancel requests stop future scheduling and mark remaining work as cancelled', async () => {
  const runStore = new ControlledRunStore();
  const dispatcher = new CountingImplementationDispatcher({
    onDispatch: async (task, runtime) => {
      if (task.task_id === 'task-api-contract') {
        await runStore.requestCancel(runtime.run_id);
      }
    },
  });
  const qualityGateRunner = new CountingQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: dispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run(buildRequest());

  assert.deepEqual(dispatcher.calls, ['task-api-contract']);
  assert.deepEqual(qualityGateRunner.calls, []);
  assert.equal(result.runtime.status, 'cancelled');
  assert.equal(result.runtime.control.cancel_requested, true);
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'implementation_done');
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'cancelled');
  assert.equal(result.runtime.tasks['task-integration-wireup'].status, 'cancelled');
  assert.equal(result.summary.final_status, 'cancelled');
});
