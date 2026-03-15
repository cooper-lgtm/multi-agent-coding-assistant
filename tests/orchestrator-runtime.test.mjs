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

test('orchestrator honors budget_policy.maxRetriesPerTask when building the runtime DAG', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [{ status: 'failed', summary: 'Fail fast.' }],
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
    budget_policy: {
      maxRetriesPerTask: 0,
    },
  });

  const task = result.runtime.tasks['task-api-contract'];
  assert.equal(task.max_retries, 0);
  assert.equal(task.retry_count, 0);
  assert.equal(task.status, 'failed');
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'blocked');
});

test('mock quality gate runner preserves explicit null model overrides', async () => {
  const fixture = buildDemoPlanningFixture();
  const targetTask = fixture.tasks[0];
  const runner = new MockQualityGateRunner({
    taskDecisions: {
      [targetTask.id]: [
        {
          status: 'completed',
          summary: 'Quality gates passed without routed models.',
          test_status: 'pass',
          review_status: 'approved',
          test_model: null,
          review_model: null,
        },
      ],
    },
  });

  const result = await runner.run(
    {
      task_id: targetTask.id,
      title: targetTask.title,
      description: targetTask.description,
      assigned_agent: targetTask.assigned_agent,
      model: 'codex',
      complexity: targetTask.complexity,
      risk: targetTask.risk,
      depends_on: targetTask.depends_on,
      acceptance_criteria: targetTask.acceptance_criteria,
      quality_gate: targetTask.quality_gate,
      status: 'implementation_done',
      test_status: 'pending',
      review_status: 'pending',
      retry_count: 0,
      max_retries: 2,
      escalation_policy: {
        on_first_failure: 'retry_same_model',
        on_second_failure: 'upgrade_model',
        on_third_failure: 'manual_orchestrator_decision',
      },
      result: null,
      error: null,
    },
    {
      run_id: 'run-test',
      epic: fixture.epic,
      graph: {
        epic: fixture.epic,
        planning_mode: fixture.planning_mode,
        source_planning_result: fixture,
        nodes: {},
        edges: [],
        parallel_groups: {},
      },
      tasks: {},
      events: [],
    },
  );

  assert.equal(result.test_model, null);
  assert.equal(result.review_model, null);
});
