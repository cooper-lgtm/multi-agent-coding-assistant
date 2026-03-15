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

test('orchestrator completes a dependency chain and returns a final summary', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
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
  assert.deepEqual(result.summary.counts, {
    completed: 3,
    needs_fix: 0,
    blocked: 0,
    failed: 0,
    pending: 0,
  });
  assert.deepEqual(
    result.summary.tasks.map((task) => [task.task_id, task.status]),
    [
      ['task-api-contract', 'completed'],
      ['task-ui-shell', 'completed'],
      ['task-integration-wireup', 'completed'],
    ],
  );
});

test('retry escalation upgrades the implementation model explicitly by role', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          { status: 'failed', summary: 'Initial implementation failed.' },
          { status: 'failed', summary: 'Retry on the same model failed again.' },
          { status: 'implementation_done', summary: 'Recovered on retry.' },
        ],
      },
    }),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'gpt-5.4', 'claude'] }),
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

  const task = result.runtime.tasks['task-api-contract'];
  assert.equal(task.status, 'completed');
  assert.equal(task.retry_count, 2);
  assert.equal(task.model, 'gpt-5.4');
  assert.match(
    result.summary.events.join('\n'),
    /retry escalation.*task-api-contract.*gpt-5\.4/i,
  );
});

test('downstream tasks become blocked when an upstream task ends needs_fix after retries', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'needs_fix',
            summary: 'Review requested changes.',
            test_status: 'pass',
            review_status: 'needs_fix',
          },
          {
            status: 'needs_fix',
            summary: 'Review still requests changes.',
            test_status: 'pass',
            review_status: 'needs_fix',
          },
          {
            status: 'needs_fix',
            summary: 'Retry budget exhausted.',
            test_status: 'pass',
            review_status: 'needs_fix',
          },
        ],
      },
    }),
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'gpt-5.4', 'claude'] }),
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

  assert.equal(result.runtime.tasks['task-api-contract'].status, 'needs_fix');
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'blocked');
  assert.equal(result.runtime.tasks['task-integration-wireup'].status, 'blocked');
  assert.equal(result.summary.final_status, 'needs_fix');
});
