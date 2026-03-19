import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MainOrchestrator,
  InMemoryRunStore,
  RetryEscalationManager,
  ReportingManager,
  buildDemoPlanningFixture,
  buildExecutionDag,
  MockQualityGateRunner,
  GooseBackedImplementationDispatcher,
} from '../dist/index.js';

function createGooseDispatcher(taskDecisions = {}) {
  return new GooseBackedImplementationDispatcher({
    repoPath: '/tmp/example-repo',
    executeRole: async (request) => {
      const taskId = request.payload.task.task_id;
      const sequence = taskDecisions[taskId] ?? [];
      const attempt = request.payload.runtime.retry_count ?? 0;
      const selected = sequence[Math.min(attempt, Math.max(sequence.length - 1, 0))] ?? {
        status: 'implementation_done',
        summary: `Goose implemented ${taskId}.`,
      };

      return {
        ok: true,
        run_id: request.run_id,
        role: request.role,
        model: request.model,
        summary: selected.summary,
        output: {
          role: request.role,
          status: selected.status,
          summary: selected.summary,
          changed_files: selected.changed_files ?? [`src/goose/${taskId}.ts`],
          blocker_category: selected.blocker_category ?? null,
          blocker_message: selected.blocker_message ?? null,
          implementation_evidence: selected.implementation_evidence ?? [selected.summary],
          test_evidence: selected.test_evidence ?? [],
          review_feedback: selected.review_feedback ?? [],
          commands_run: selected.commands_run ?? ['npm run build'],
          test_results: selected.test_results ?? [],
          risk_notes: selected.risk_notes ?? [],
          suggested_status: selected.suggested_status ?? selected.status,
          delivery_metadata: selected.delivery_metadata ?? {
            branch_name: `feat/${taskId}`,
            commit_sha: 'abc1234',
            pr_url: `https://example.invalid/pr/${taskId}`,
          },
          prior_attempt: request.payload.prior_attempt ?? null,
        },
      };
    },
  });
}

function createGooseAdapterErrorDispatcher({ message, retryable, code = 'execution_failed' }) {
  return new GooseBackedImplementationDispatcher({
    repoPath: '/tmp/example-repo',
    executeRole: async (request) => ({
      envelope_version: 'openclaw.role-exec.v1',
      ok: false,
      role_type: request.role_type,
      role: request.role,
      model: request.model,
      error: {
        code,
        message,
        retryable,
      },
    }),
  });
}

test('orchestrator routes implementation through goose while keeping quality gates external', async () => {
  const fixture = buildDemoPlanningFixture();
  const qualityGateRunner = new MockQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: createGooseDispatcher(),
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
  for (const task of Object.values(result.runtime.tasks)) {
    assert.ok(task.commands_run.length > 0);
    assert.equal(task.delivery_metadata?.commit_sha, 'abc1234');
    assert.equal(task.test_status, 'pass');
    assert.equal(task.review_status, 'approved');
    assert.match(task.test_evidence.join('\n'), /test-agent/i);
    assert.match(task.review_feedback.join('\n'), /review-agent/i);
  }
});

test('orchestrator retries goose implementation after needs_fix feedback and persists evidence', async () => {
  const fixture = buildDemoPlanningFixture();
  const runStore = new InMemoryRunStore();

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: createGooseDispatcher({
      'task-api-contract': [
        {
          status: 'implementation_done',
          summary: 'First goose implementation attempt complete.',
          commands_run: ['npm run build'],
        },
        {
          status: 'implementation_done',
          summary: 'Second goose implementation attempt addresses feedback.',
          commands_run: ['npm run build', 'npm run test:runtime'],
        },
      ],
    }),
    qualityGateRunner: new MockQualityGateRunner({
      taskDecisions: {
        'task-api-contract': [
          {
            status: 'needs_fix',
            summary: 'Review requested changes.',
            test_status: 'pass',
            review_status: 'needs_fix',
            review_feedback: ['review-agent requested changes for task-api-contract on claude.'],
          },
          {
            status: 'completed',
            summary: 'Quality gates passed after fixes.',
            test_status: 'pass',
            review_status: 'approved',
          },
        ],
      },
    }),
    retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run({
    request: 'demo',
    project_summary: 'demo',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
  });

  assert.equal(result.summary.final_status, 'completed');
  const task = result.runtime.tasks['task-api-contract'];
  assert.equal(task.retry_count, 1);
  assert.equal(task.prior_attempt?.status, 'needs_fix');
  assert.match(task.prior_attempt?.summary ?? '', /review requested changes/i);
  assert.ok(task.commands_run.includes('npm run test:runtime'));

  const persisted = await runStore.load(result.runtime.run_id);
  assert.ok(persisted);
  assert.deepEqual(persisted.tasks['task-api-contract'].commands_run, task.commands_run);
});

test('orchestrator treats non-retryable goose adapter errors as terminal blocked work', async () => {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: createGooseAdapterErrorDispatcher({
      message: 'Goose binary is unavailable on this machine.',
      retryable: false,
      code: 'adapter_unavailable',
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
  assert.equal(task.status, 'blocked');
  assert.equal(task.retry_count, 0);
  assert.equal(task.blocker_category, 'environment');
  assert.match(task.blocker_message ?? '', /unavailable/i);
  assert.ok(result.summary.events.every((event) => !/retry scheduled/i.test(event)));
});

test('retry escalation tolerates legacy tasks without fallback_models', () => {
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), { runId: 'legacy-fallback-models' });
  const task = runtime.tasks['task-api-contract'];
  const retryManager = new RetryEscalationManager({ availableModels: ['codex', 'claude'] });

  task.retry_count = 1;
  delete task.fallback_models;

  const decision = retryManager.decide(task, 'implementation_failed');

  assert.equal(decision.action, 'retry_with_upgraded_model');
  assert.equal(decision.next_model, 'claude');
  assert.equal(decision.retry_count, 2);
});
