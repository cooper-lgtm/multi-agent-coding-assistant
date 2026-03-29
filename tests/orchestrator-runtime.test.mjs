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
  buildExecutionDag,
} from '../dist/index.js';

function buildSingleTaskFixtureWithExecutionGuidance() {
  const fixture = buildDemoPlanningFixture();
  const singleTask = structuredClone(fixture.tasks[0]);

  singleTask.execution_guidance = {
    must_read_files: ['README.md'],
    verification_commands: ['npm run build', 'npm run test:runtime'],
    environment_checks: ['git status --short'],
    definition_of_done: ['Verification commands ran before quality gates.'],
    reconsider_signals: ['Verification evidence is missing from the worker handoff.'],
  };

  return {
    ...fixture,
    tasks: [singleTask],
  };
}

class RecordingImplementationDispatcher {
  constructor(inner, calls) {
    this.inner = inner;
    this.calls = calls;
  }

  async dispatch(task, runtime) {
    this.calls.push({
      task_id: task.task_id,
      retry_count: task.retry_count,
      checklist_feedback: [...(task.checklist_feedback ?? [])],
      failure_category: task.failure_category ?? null,
      failure_diagnosis: task.failure_diagnosis ?? null,
      reconsider_instructions: [...(task.reconsider_instructions ?? [])],
      repeated_pattern_summary: task.repeated_pattern_summary ?? null,
      attempt_history: structuredClone(task.attempt_history ?? []),
      prior_attempt: task.prior_attempt ? structuredClone(task.prior_attempt) : null,
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
    cancelled: 0,
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
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
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
  assert.equal(task.model, 'claude');
  assert.equal(task.prior_attempt?.attempt, 2);
  assert.equal(task.prior_attempt?.status, 'failed');
  assert.match(task.prior_attempt?.summary ?? '', /same model failed again/i);
  assert.deepEqual(task.changed_files, ['src/mock/task-api-contract.ts']);
  assert.deepEqual(task.implementation_evidence, [
    'Recovered on retry.',
    'Attempt 3 finished implementation for task-api-contract.',
  ]);
  assert.deepEqual(task.test_evidence, [
    'test-agent passed for task-api-contract on codex.',
  ]);
  assert.deepEqual(task.review_feedback, [
    'review-agent approved task-api-contract on claude.',
  ]);
  assert.match(
    result.summary.events.join('\n'),
    /retry escalation.*task-api-contract.*claude/i,
  );
});

test('default runtime middleware injects loop-detection guidance before a third low-yield retry', async () => {
  const fixture = buildDemoPlanningFixture();
  fixture.tasks = [structuredClone(fixture.tasks[0])];
  const implementationCalls = [];

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new RecordingImplementationDispatcher(
      new MockImplementationDispatcher({
        taskDecisions: {
          'task-api-contract': [
            {
              status: 'failed',
              summary: 'Attempt 1 repeated the same repository blocker.',
              changed_files: ['src/api/generated-client.ts'],
              blocker_category: 'repository',
              blocker_message: 'Generated client stub is missing.',
              commands_run: ['npm run build'],
              test_evidence: [],
            },
            {
              status: 'failed',
              summary: 'Attempt 2 repeated the same repository blocker.',
              changed_files: ['src/api/generated-client.ts'],
              blocker_category: 'repository',
              blocker_message: 'Generated client stub is missing.',
              commands_run: ['npm run build'],
              test_evidence: [],
            },
            {
              status: 'implementation_done',
              summary: 'Attempt 3 changed approach and regenerated the missing client stub.',
              changed_files: ['src/api/generated-client.ts', 'tests/api-client.test.mjs'],
              commands_run: ['npm run build', 'node --test tests/orchestrator-runtime.test.mjs'],
              test_evidence: ['node --test tests/orchestrator-runtime.test.mjs'],
            },
          ],
        },
      }),
      implementationCalls,
    ),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
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
  assert.equal(implementationCalls.length, 3);
  assert.equal(implementationCalls[2].retry_count, 2);
  assert.equal(implementationCalls[2].failure_category, 'implementation_failed');
  assert.match(
    implementationCalls[2].failure_diagnosis ?? '',
    /generated client stub is missing/i,
  );
  assert.equal(implementationCalls[2].prior_attempt?.failure_category, 'implementation_failed');
  assert.equal(implementationCalls[2].attempt_history.length, 2);
  assert.match(
    implementationCalls[2].repeated_pattern_summary ?? '',
    /same blocker on unchanged files/i,
  );
  assert.ok(
    implementationCalls[2].reconsider_instructions.some((instruction) =>
      /change approach/i.test(instruction),
    ),
  );
  assert.ok(
    implementationCalls[2].reconsider_instructions.some((instruction) =>
      /generated client stub is missing/i.test(instruction),
    ),
  );
  assert.match(
    result.summary.events.join('\n'),
    /retry loop detected for task-api-contract/i,
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
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
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
  assert.equal(result.runtime.tasks['task-api-contract'].blocker_category, 'quality');
  assert.equal(
    result.runtime.tasks['task-api-contract'].blocker_message,
    'Retry budget exhausted.',
  );
  assert.deepEqual(result.runtime.tasks['task-api-contract'].review_feedback, [
    'Retry budget exhausted.',
  ]);
  assert.equal(
    result.runtime.tasks['task-api-contract'].prior_attempt?.summary,
    'Review still requests changes.',
  );
  assert.equal(result.runtime.tasks['task-ui-shell'].status, 'blocked');
  assert.equal(result.runtime.tasks['task-ui-shell'].blocker_category, 'dependency');
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
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
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

test('mock quality gate runner treats pending statuses as non-success evidence', async () => {
  const fixture = buildDemoPlanningFixture();
  const targetTask = fixture.tasks[0];
  const runner = new MockQualityGateRunner({
    availableModels: ['codex', 'claude'],
    taskDecisions: {
      [targetTask.id]: [
        {
          status: 'failed',
          summary: 'Quality gates could not start because the implementation artifact was missing.',
          test_status: 'pending',
          review_status: 'pending',
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

  assert.equal(result.test_model, 'codex');
  assert.equal(result.review_model, 'claude');
  assert.deepEqual(result.test_evidence, ['test-agent pending for task-api-contract on codex.']);
  assert.deepEqual(result.review_feedback, ['review-agent pending for task-api-contract on claude.']);
});

test('orchestrator summary carries richer worker bridge details into reporting', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new MockImplementationDispatcher({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'failed',
            summary: 'Repository fixture is missing a generated client stub.',
            changed_files: ['src/api/contract.ts'],
            blocker_category: 'repository',
            blocker_message: 'Repository fixture is missing a generated client stub.',
            implementation_evidence: ['Updated the API contract before the missing stub blocked progress.'],
            test_evidence: [],
            review_feedback: [],
            commands_run: ['npm run build'],
            test_results: [
              {
                name: 'tests/orchestrator-runtime.test.mjs',
                status: 'fail',
                details: 'Generated client stub missing from repository fixture.',
              },
            ],
            risk_notes: ['Client stub generation is still blocked on missing repository fixtures.'],
            suggested_status: 'blocked',
            delivery_metadata: {
              branch_name: 'feat/goose-worker-contracts',
              commit_sha: 'deadbeef0',
            },
          },
          {
            status: 'implementation_done',
            summary: 'Repository issue resolved and implementation completed.',
            changed_files: ['src/api/contract.ts', 'src/api/client.ts'],
            blocker_category: null,
            blocker_message: null,
            implementation_evidence: ['Added the generated client stub and finished the contract update.'],
            test_evidence: [],
            review_feedback: [],
            commands_run: [
              'npm run build',
              'node --test tests/orchestrator-runtime.test.mjs',
            ],
            test_results: [
              {
                name: 'tests/orchestrator-runtime.test.mjs',
                status: 'pass',
              },
            ],
            risk_notes: ['Broaden integration coverage for the regenerated client stub.'],
            suggested_status: 'implementation_done',
            delivery_metadata: {
              branch_name: 'feat/goose-worker-contracts',
              commit_sha: 'deadbeef1',
              pr_url: 'https://github.com/example/repo/pull/123',
            },
          },
        ],
      },
    }),
    qualityGateRunner: new MockQualityGateRunner({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'completed',
            summary: 'Quality gates passed after the retry.',
            changed_files: ['src/api/contract.ts', 'src/api/client.ts'],
            blocker_category: null,
            blocker_message: null,
            implementation_evidence: ['Added the generated client stub and finished the contract update.'],
            test_evidence: ['npm run test:adapter passed after the retry.'],
            review_feedback: ['Review approved the regenerated client stub.'],
            test_status: 'pass',
            review_status: 'approved',
          },
        ],
      },
    }),
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
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

  const summaryTask = result.summary.tasks.find((task) => task.task_id === 'task-api-contract');
  assert.ok(summaryTask);
  assert.deepEqual(summaryTask.changed_files, ['src/api/contract.ts', 'src/api/client.ts']);
  assert.equal(summaryTask.blocker_category, null);
  assert.equal(summaryTask.blocker_message, null);
  assert.deepEqual(summaryTask.implementation_evidence, [
    'Added the generated client stub and finished the contract update.',
  ]);
  assert.deepEqual(summaryTask.test_evidence, ['npm run test:adapter passed after the retry.']);
  assert.deepEqual(summaryTask.review_feedback, ['Review approved the regenerated client stub.']);
  assert.deepEqual(summaryTask.commands_run, [
    'npm run build',
    'node --test tests/orchestrator-runtime.test.mjs',
  ]);
  assert.deepEqual(summaryTask.test_results, [
    { name: 'tests/orchestrator-runtime.test.mjs', status: 'pass' },
  ]);
  assert.deepEqual(summaryTask.risk_notes, [
    'Broaden integration coverage for the regenerated client stub.',
  ]);
  assert.equal(summaryTask.suggested_status, 'implementation_done');
  assert.equal(summaryTask.delivery_metadata?.pr_url, 'https://github.com/example/repo/pull/123');
  assert.equal(summaryTask.prior_attempt?.attempt, 1);
  assert.equal(summaryTask.prior_attempt?.status, 'failed');
  assert.equal(
    summaryTask.prior_attempt?.blocker_message,
    'Repository fixture is missing a generated client stub.',
  );
  assert.deepEqual(summaryTask.prior_attempt?.commands_run, ['npm run build']);
  assert.deepEqual(summaryTask.prior_attempt?.test_results, [
    {
      name: 'tests/orchestrator-runtime.test.mjs',
      status: 'fail',
      details: 'Generated client stub missing from repository fixture.',
    },
  ]);
  assert.deepEqual(summaryTask.prior_attempt?.risk_notes, [
    'Client stub generation is still blocked on missing repository fixtures.',
  ]);
  assert.equal(summaryTask.prior_attempt?.suggested_status, 'blocked');
  assert.equal(summaryTask.prior_attempt?.delivery_metadata?.commit_sha, 'deadbeef0');
});

test('reporting summary tolerates legacy runtime tasks without checklist feedback', () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-legacy-summary-checklist-feedback',
  });
  const reportingManager = new ReportingManager();

  delete runtime.tasks['task-api-contract'].checklist_feedback;

  const summary = reportingManager.buildSummary(runtime);
  const summaryTask = summary.tasks.find((task) => task.task_id === 'task-api-contract');

  assert.ok(summaryTask);
  assert.deepEqual(summaryTask.checklist_feedback, []);
});

test('runtime flow continues unverified implementation before external quality gates decide completion', async () => {
  const fixture = buildSingleTaskFixtureWithExecutionGuidance();
  const implementationCalls = [];
  const qualityGateCalls = [];

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new RecordingImplementationDispatcher(
      new MockImplementationDispatcher({
        taskDecisions: {
          'task-api-contract': [
            {
              status: 'implementation_done',
              summary: 'Attempt 1 changed code but skipped one required verification command.',
              commands_run: ['npm run build'],
            },
            {
              status: 'implementation_done',
              summary: 'Attempt 2 included the missing verification command.',
              commands_run: ['npm run build', 'npm run test:runtime'],
            },
          ],
        },
      }),
      implementationCalls,
    ),
    qualityGateRunner: new RecordingQualityGateRunner(
      new MockQualityGateRunner({
        taskDecisions: {
          'task-api-contract': [
            {
              status: 'completed',
              summary: 'External quality gates approved the verified implementation.',
              test_status: 'pass',
              review_status: 'approved',
            },
          ],
        },
      }),
      qualityGateCalls,
    ),
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
  assert.deepEqual(implementationCalls.map((call) => call.task_id), [
    'task-api-contract',
    'task-api-contract',
  ]);
  assert.deepEqual(qualityGateCalls, ['task-api-contract']);
  assert.deepEqual(implementationCalls[1].checklist_feedback, [
    'Missing verification evidence for required command: npm run test:runtime',
  ]);
  assert.deepEqual(implementationCalls[1].prior_attempt?.checklist_feedback, [
    'Missing verification evidence for required command: npm run test:runtime',
  ]);
  assert.equal(
    implementationCalls[1].prior_attempt?.summary,
    'Missing required verification evidence before external quality gates. Run the missing commands and return explicit evidence.',
  );
  assert.equal(result.runtime.tasks['task-api-contract'].status, 'completed');
  assert.deepEqual(result.runtime.tasks['task-api-contract'].checklist_feedback, []);
  assert.match(
    result.summary.events.join('\n'),
    /pre-completion checklist requested task continuation/i,
  );
});
