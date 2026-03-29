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
  const singleTask = structuredClone(fixture.tasks[0]);

  singleTask.execution_guidance = {
    must_read_files: ['README.md'],
    verification_commands: ['npm run build', 'npm run test:runtime'],
    environment_checks: ['git status --short'],
    definition_of_done: ['Required verification commands ran before external quality gates.'],
    reconsider_signals: ['Verification evidence is missing from the implementation handoff.'],
  };

  return {
    ...fixture,
    tasks: [singleTask],
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
      checklist_feedback: [...(task.checklist_feedback ?? [])],
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

test('pre-completion checklist continues the task when required verification command evidence is missing', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const dispatchSnapshots = [];
  const qualityGateCalls = [];
  const expectedFeedback = [
    'Missing verification evidence for required command: npm run build',
    'Missing verification evidence for required command: npm run test:runtime',
  ];

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Implemented the API contract but did not run the required verification loop.',
            commands_run: ['git status --short'],
          },
          {
            status: 'implementation_done',
            summary: 'Implemented the API contract and ran the required verification commands.',
            commands_run: ['npm run build', 'npm run test:runtime'],
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
  assert.deepEqual(dispatchSnapshots[1].checklist_feedback, expectedFeedback);
  assert.deepEqual(dispatchSnapshots[1].prior_attempt?.checklist_feedback, expectedFeedback);
  assert.equal(
    dispatchSnapshots[1].prior_attempt?.summary,
    'Missing required verification evidence before external quality gates. Run the missing commands and return explicit evidence.',
  );
  assert.match(
    result.summary.events.join('\n'),
    /pre-completion checklist.*requested task continuation/i,
  );
});

test('pre-completion checklist fails closed after repeated missing verification evidence', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const qualityGateCalls = [];

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Attempt 1 skipped verification commands.',
            commands_run: [],
          },
          {
            status: 'implementation_done',
            summary: 'Attempt 2 still skipped verification commands.',
            commands_run: [],
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
  assert.deepEqual(dispatchCalls, ['task-api-contract', 'task-api-contract']);
  assert.deepEqual(qualityGateCalls, []);
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'failed');
  assert.equal(result.runtime.tasks['task-api-contract'].blocker_category, 'quality');
  assert.match(
    result.runtime.tasks['task-api-contract'].blocker_message ?? '',
    /continuation budget/i,
  );
});

test('pre-completion checklist allows verified implementation to proceed directly to quality gates', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const dispatchCalls = [];
  const qualityGateCalls = [];

  const implementationDispatcher = new RecordingImplementationDispatcher(
    new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'implementation_done',
            summary: 'Implemented the API contract and ran the required verification loop.',
            commands_run: ['npm run build', 'npm run test:runtime'],
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
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
  });

  assert.equal(result.summary.final_status, 'completed');
  assert.deepEqual(dispatchCalls, ['task-api-contract']);
  assert.deepEqual(qualityGateCalls, ['task-api-contract']);
  assert.deepEqual(result.runtime.tasks['task-api-contract'].checklist_feedback, []);
  assert.doesNotMatch(
    result.summary.events.join('\n'),
    /requested task continuation/i,
  );
});
