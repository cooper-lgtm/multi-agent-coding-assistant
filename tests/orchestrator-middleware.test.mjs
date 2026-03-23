import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MainOrchestrator,
  MockImplementationDispatcher,
  MockQualityGateRunner,
  InMemoryRunStore,
  RetryEscalationManager,
  ReportingManager,
  buildDemoPlanningFixture,
} from '../dist/index.js';

function buildSingleTaskPlanningFixture() {
  const fixture = buildDemoPlanningFixture();

  return {
    ...fixture,
    tasks: [structuredClone(fixture.tasks[0])],
  };
}

class RecordingImplementationDispatcher {
  constructor(inner, calls, snapshots = null) {
    this.inner = inner;
    this.calls = calls;
    this.snapshots = snapshots;
  }

  async dispatch(task, runtime) {
    this.calls.push(task.task_id);
    this.snapshots?.push({
      task_id: task.task_id,
      retry_count: task.retry_count,
      prior_attempt: task.prior_attempt ? structuredClone(task.prior_attempt) : null,
      error: task.error,
    });
    return this.inner.dispatch(task, runtime);
  }
}

class RecordingQualityGateRunner {
  constructor(inner, calls) {
    this.inner = inner;
    this.calls = calls;
  }

  async run(task, runtime) {
    this.calls.push(task.task_id);
    return this.inner.run(task, runtime);
  }
}

test('orchestrator runs registered runtime middleware hooks in phase order', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const phases = [];

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    runtimeMiddleware: [
      {
        name: 'phase-recorder',
        beforeDispatch({ task }) {
          phases.push(`before_dispatch:${task.task_id}`);
        },
        afterImplementationAttempt({ task, dispatchResult }) {
          phases.push(`after_implementation_attempt:${task.task_id}:${dispatchResult.status}`);
        },
        beforeQualityGates({ task }) {
          phases.push(`before_quality_gates:${task.task_id}`);
        },
      },
    ],
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
  });

  assert.equal(result.summary.final_status, 'completed');
  assert.deepEqual(phases, [
    'before_dispatch:task-api-contract',
    'after_implementation_attempt:task-api-contract:implementation_done',
    'before_quality_gates:task-api-contract',
  ]);
});

test('middleware can request task continuation before quality gates and redispatch with continuation context', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const dispatchSnapshots = [];
  const qualityGateCalls = [];
  const phases = [];
  let shouldContinue = true;

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Initial implementation finished without verification.',
          },
          {
            status: 'implementation_done',
            summary: 'Second implementation attempt includes verification.',
          },
        ],
      },
    }),
    dispatchCalls,
    dispatchSnapshots,
  );
  const qualityGateRunner = new RecordingQualityGateRunner(new MockQualityGateRunner(), qualityGateCalls);

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    runtimeMiddleware: [
      {
        name: 'continuation-recorder',
        beforeDispatch({ task }) {
          phases.push(`before_dispatch:${task.task_id}`);
        },
        afterImplementationAttempt({ task, dispatchResult }) {
          phases.push(`after_implementation_attempt:${task.task_id}:${dispatchResult.summary}`);
        },
        beforeQualityGates({ task }) {
          phases.push(`before_quality_gates:${task.task_id}:${task.result}`);
          if (!shouldContinue) {
            return undefined;
          }

          shouldContinue = false;
          return {
            action: 'continue_task',
            message: 'Run the expected local verification loop before external quality gates.',
          };
        },
      },
    ],
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
  });

  assert.equal(result.summary.final_status, 'completed');
  assert.deepEqual(dispatchCalls, ['task-api-contract', 'task-api-contract']);
  assert.deepEqual(qualityGateCalls, ['task-api-contract']);
  assert.equal(result.runtime.tasks['task-api-contract'].retry_count, 1);
  assert.equal(dispatchSnapshots[1].retry_count, 1);
  assert.equal(dispatchSnapshots[1].prior_attempt?.status, 'needs_fix');
  assert.equal(
    dispatchSnapshots[1].prior_attempt?.summary,
    'Run the expected local verification loop before external quality gates.',
  );
  assert.equal(
    result.runtime.tasks['task-api-contract'].prior_attempt?.summary,
    'Run the expected local verification loop before external quality gates.',
  );
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'completed');
  assert.match(
    result.summary.events.join('\n'),
    /runtime middleware .* requested task continuation/i,
  );
  assert.deepEqual(phases, [
    'before_dispatch:task-api-contract',
    'after_implementation_attempt:task-api-contract:Initial implementation finished without verification.',
    'before_quality_gates:task-api-contract:Initial implementation finished without verification.',
    'before_dispatch:task-api-contract',
    'after_implementation_attempt:task-api-contract:Second implementation attempt includes verification.',
    'before_quality_gates:task-api-contract:Second implementation attempt includes verification.',
  ]);
});

test('middleware continuations fail closed when they exceed the task retry budget', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const qualityGateCalls = [];
  let continuationRequests = 0;

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Attempt 1 finished without enough verification evidence.',
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 2 still did not satisfy the middleware.',
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 3 should never be dispatched.',
          },
        ],
      },
    }),
    dispatchCalls,
  );
  const qualityGateRunner = new RecordingQualityGateRunner(new MockQualityGateRunner(), qualityGateCalls);

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    runtimeMiddleware: [
      {
        name: 'always-continue-until-budget-exhausted',
        beforeQualityGates() {
          continuationRequests += 1;
          if (continuationRequests > 2) {
            return undefined;
          }

          return {
            action: 'continue_task',
            message: 'Verification evidence is still incomplete.',
          };
        },
      },
    ],
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
    budget_policy: {
      maxRetriesPerTask: 1,
    },
  });

  assert.equal(result.summary.final_status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].retry_count, 1);
  assert.equal(
    result.runtime.tasks['task-api-contract'].blocker_message,
    'Runtime middleware requested more continuations than task-api-contract allows.',
  );
  assert.deepEqual(dispatchCalls, ['task-api-contract', 'task-api-contract']);
  assert.deepEqual(qualityGateCalls, []);
  assert.match(
    result.summary.events.join('\n'),
    /continuation budget/i,
  );
});

test('middleware continuation consumes retry budget before a later implementation failure', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const dispatchSnapshots = [];
  const qualityGateCalls = [];
  let shouldContinue = true;

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Attempt 1 stopped before the expected verification loop.',
          },
          {
            status: 'failed',
            summary: 'Attempt 2 still failed after the continuation.',
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 3 should never be dispatched.',
          },
        ],
      },
    }),
    dispatchCalls,
    dispatchSnapshots,
  );
  const qualityGateRunner = new RecordingQualityGateRunner(new MockQualityGateRunner(), qualityGateCalls);

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    runtimeMiddleware: [
      {
        name: 'single-continuation',
        beforeQualityGates() {
          if (!shouldContinue) {
            return undefined;
          }

          shouldContinue = false;
          return {
            action: 'continue_task',
            message: 'Finish the verification loop before asking for review.',
          };
        },
      },
    ],
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
    budget_policy: {
      maxRetriesPerTask: 1,
    },
  });

  assert.equal(result.summary.final_status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].retry_count, 1);
  assert.equal(result.runtime.tasks['task-api-contract'].error, 'Attempt 2 still failed after the continuation.');
  assert.deepEqual(dispatchCalls, ['task-api-contract', 'task-api-contract']);
  assert.equal(dispatchSnapshots[1].retry_count, 1);
  assert.deepEqual(qualityGateCalls, []);
  assert.ok(result.summary.events.every((event) => !/retry scheduled/i.test(event)));
});

test('middleware continuations share the same per-task budget as earlier retries', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const qualityGateCalls = [];
  let shouldContinue = true;

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'failed',
            summary: 'Attempt 1 failed before it reached verification.',
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 2 finished implementation after the retry.',
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 3 should never be dispatched.',
          },
        ],
      },
    }),
    dispatchCalls,
  );
  const qualityGateRunner = new RecordingQualityGateRunner(new MockQualityGateRunner(), qualityGateCalls);

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
    qualityGateRunner,
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    runtimeMiddleware: [
      {
        name: 'retry-aware-continuation-guard',
        beforeQualityGates() {
          if (!shouldContinue) {
            return undefined;
          }

          shouldContinue = false;
          return {
            action: 'continue_task',
            message: 'Additional verification is still required.',
          };
        },
      },
    ],
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
    budget_policy: {
      maxRetriesPerTask: 1,
    },
  });

  assert.equal(result.summary.final_status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].retry_count, 1);
  assert.equal(
    result.runtime.tasks['task-api-contract'].blocker_message,
    'Runtime middleware requested more continuations than task-api-contract allows.',
  );
  assert.deepEqual(dispatchCalls, ['task-api-contract', 'task-api-contract']);
  assert.deepEqual(qualityGateCalls, []);
  assert.match(
    result.summary.events.join('\n'),
    /continuation budget/i,
  );
});
