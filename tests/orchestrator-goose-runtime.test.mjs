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

function addExecutionGuidance(fixture) {
  for (const task of fixture.tasks) {
    task.execution_guidance = {
      must_read_files: [
        'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
        'docs/plans/2026-04-01-goose-plan-linked-docs.md',
        'README.md',
        `prompts/${task.assigned_agent}.md`,
      ],
      verification_commands: ['npm run build', 'npm run test:runtime'],
      environment_checks: ['git status --short'],
      definition_of_done: [`${task.id} uses injected runtime context before handoff.`],
      reconsider_signals: [`${task.id} lost injected verification guidance.`],
    };
  }

  return fixture;
}

function createGooseDispatcher(taskDecisions = {}, capturedRequests = []) {
  return new GooseBackedImplementationDispatcher({
    repoPath: process.cwd(),
    executeRole: async (request) => {
      capturedRequests.push(request);
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
          commands_run: selected.commands_run ?? (
            request.payload.runtime_context?.verification_plan.commands.length
              ? request.payload.runtime_context.verification_plan.commands
              : ['npm run build']
          ),
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
    repoPath: process.cwd(),
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

test(
  'orchestrator routes implementation through goose while keeping quality gates external',
  { concurrency: false },
  async () => {
  const fixture = addExecutionGuidance(buildDemoPlanningFixture());
  const capturedRequests = [];
  const qualityGateRunner = new MockQualityGateRunner();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: createGooseDispatcher({}, capturedRequests),
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

  const firstRequest = capturedRequests.find((request) => request.payload.task.task_id === 'task-api-contract');

  assert.ok(firstRequest);
  assert.ok(firstRequest.payload.runtime_context);
  assert.ok(firstRequest.payload.runtime_context.repo_context_summary.length > 0);
  assert.deepEqual(firstRequest.payload.runtime_context.task_context_files, [
    'docs/context/repo-context.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs.md',
    'README.md',
    'prompts/backend-agent.md',
  ]);
  assert.deepEqual(firstRequest.payload.runtime_context.verification_plan.commands, [
    'npm run build',
    'npm run test:runtime',
  ]);
  assert.deepEqual(firstRequest.payload.runtime_context.verification_plan.environment_checks, [
    'git status --short',
  ]);
  assert.deepEqual(firstRequest.payload.runtime_context.verification_plan.definition_of_done, [
    'task-api-contract uses injected runtime context before handoff.',
  ]);
  assert.deepEqual(firstRequest.payload.runtime_context.verification_plan.reconsider_signals, [
    'task-api-contract lost injected verification guidance.',
  ]);
  },
);

test(
  'orchestrator retries goose implementation after needs_fix feedback and persists evidence',
  { concurrency: false },
  async () => {
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
  },
);

test(
  'goose third attempt payload includes retry diagnosis and loop-detection guidance',
  { concurrency: false },
  async () => {
  const fixture = buildDemoPlanningFixture();
  fixture.tasks = [structuredClone(fixture.tasks[0])];
  const receivedAttempts = [];

  const implementationDispatcher = new GooseBackedImplementationDispatcher({
    repoPath: '/tmp/example-repo',
    executeRole: async (request) => {
      receivedAttempts.push({
        retry_count: request.payload.runtime.retry_count,
        model: request.model,
        prior_attempt: request.payload.prior_attempt ? structuredClone(request.payload.prior_attempt) : null,
        attempt_history: structuredClone(request.payload.attempt_history ?? []),
        reconsider_instructions: [...(request.payload.reconsider_instructions ?? [])],
        repeated_pattern_summary: request.payload.repeated_pattern_summary ?? null,
        runtime_retry_handoff: request.payload.runtime_context?.verification_plan.retry_handoff
          ? structuredClone(request.payload.runtime_context.verification_plan.retry_handoff)
          : null,
      });

      const attempt = receivedAttempts.length;
      const isRetryLoopAttempt = attempt < 3;

      return {
        ok: true,
        run_id: request.run_id,
        role: request.role,
        model: request.model,
        summary: isRetryLoopAttempt
          ? `Goose attempt ${attempt} repeated the same repository blocker.`
          : 'Goose attempt 3 changed approach and regenerated the missing client stub.',
        output: {
          role: request.role,
          status: isRetryLoopAttempt ? 'failed' : 'implementation_done',
          summary: isRetryLoopAttempt
            ? `Goose attempt ${attempt} repeated the same repository blocker.`
            : 'Goose attempt 3 changed approach and regenerated the missing client stub.',
          changed_files: isRetryLoopAttempt
            ? ['src/api/generated-client.ts']
            : ['src/api/generated-client.ts', 'tests/api-client.test.mjs'],
          blocker_category: isRetryLoopAttempt ? 'repository' : null,
          blocker_message: isRetryLoopAttempt ? 'Generated client stub is missing.' : null,
          implementation_evidence: isRetryLoopAttempt
            ? [`Goose attempt ${attempt} still could not regenerate the client stub.`]
            : ['Goose regenerated the client stub and updated coverage.'],
          test_evidence: isRetryLoopAttempt
            ? []
            : ['node --test tests/orchestrator-goose-runtime.test.mjs'],
          review_feedback: [],
          commands_run: isRetryLoopAttempt
            ? ['npm run build']
            : ['npm run build', 'node --test tests/orchestrator-goose-runtime.test.mjs'],
          test_results: [],
          risk_notes: [],
          suggested_status: isRetryLoopAttempt ? 'failed' : 'implementation_done',
          delivery_metadata: null,
          prior_attempt: request.payload.prior_attempt ?? null,
        },
      };
    },
  });

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
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
  assert.equal(receivedAttempts.length, 3);
  assert.equal(receivedAttempts[2].retry_count, 2);
  assert.equal(receivedAttempts[2].model.logical_model, 'claude');
  assert.equal(receivedAttempts[2].prior_attempt?.failure_category, 'implementation_failed');
  assert.match(
    receivedAttempts[2].prior_attempt?.failure_diagnosis ?? '',
    /generated client stub is missing/i,
  );
  assert.equal(receivedAttempts[2].attempt_history.length, 2);
  assert.equal(receivedAttempts[2].attempt_history[1].failure_category, 'implementation_failed');
  assert.match(
    receivedAttempts[2].repeated_pattern_summary ?? '',
    /same blocker on unchanged files/i,
  );
  assert.ok(
    receivedAttempts[2].reconsider_instructions.some((instruction) =>
      /change approach/i.test(instruction),
    ),
  );
  assert.ok(
    receivedAttempts[2].reconsider_instructions.some((instruction) =>
      /generated client stub is missing/i.test(instruction),
    ),
  );
  assert.match(
    receivedAttempts[2].runtime_retry_handoff?.failure_diagnosis ?? '',
    /generated client stub is missing/i,
  );
  assert.match(
    result.summary.events.join('\n'),
    /retry loop detected for task-api-contract/i,
  );
  },
);

test(
  'goose redispatch receives checklist continuation context before external quality gates run',
  { concurrency: false },
  async () => {
  const fixture = addExecutionGuidance(buildDemoPlanningFixture());
  fixture.tasks = [structuredClone(fixture.tasks[0])];
  const receivedAttempts = [];
  const qualityGateCalls = [];

  const implementationDispatcher = new GooseBackedImplementationDispatcher({
    repoPath: '/tmp/example-repo',
    executeRole: async (request) => {
      receivedAttempts.push({
        retry_count: request.payload.runtime.retry_count,
        prior_attempt: request.payload.prior_attempt ? structuredClone(request.payload.prior_attempt) : null,
        runtime_retry_handoff: request.payload.runtime_context?.verification_plan.retry_handoff
          ? structuredClone(request.payload.runtime_context.verification_plan.retry_handoff)
          : null,
      });

      const attempt = receivedAttempts.length;

      return {
        ok: true,
        run_id: request.run_id,
        role: request.role,
        model: request.model,
        summary: `Goose implementation attempt ${attempt}.`,
        output: {
          role: request.role,
          status: 'implementation_done',
          summary: `Goose implementation attempt ${attempt}.`,
          changed_files: [`src/goose/task-api-contract-attempt-${attempt}.ts`],
          blocker_category: null,
          blocker_message: null,
          implementation_evidence: [`Implementation attempt ${attempt}.`],
          test_evidence: [],
          review_feedback: [],
          commands_run: attempt === 1
            ? ['npm run build']
            : ['npm run build', 'npm run test:runtime'],
          test_results: [],
          risk_notes: [],
          suggested_status: 'implementation_done',
          delivery_metadata: null,
          prior_attempt: request.payload.prior_attempt ?? null,
        },
      };
    },
  });

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher,
    qualityGateRunner: {
      async run(task, runtime) {
        qualityGateCalls.push(task.task_id);
        return new MockQualityGateRunner().run(task, runtime);
      },
    },
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
  assert.equal(receivedAttempts.length, 2);
  assert.deepEqual(qualityGateCalls, ['task-api-contract']);
  assert.equal(receivedAttempts[0].retry_count, 0);
  assert.equal(receivedAttempts[0].prior_attempt, null);
  assert.equal(receivedAttempts[1].retry_count, 1);
  assert.equal(receivedAttempts[1].prior_attempt?.status, 'needs_fix');
  assert.equal(receivedAttempts[1].prior_attempt?.attempt, 1);
  assert.equal(
    receivedAttempts[1].prior_attempt?.summary,
    'Missing required verification evidence before external quality gates. Run the missing commands and return explicit evidence.',
  );
  assert.deepEqual(receivedAttempts[1].prior_attempt?.checklist_feedback, [
    'Missing verification evidence for required command: npm run test:runtime',
  ]);
  assert.deepEqual(receivedAttempts[1].runtime_retry_handoff?.checklist_feedback, [
    'Missing verification evidence for required command: npm run test:runtime',
  ]);
  },
);

test(
  'orchestrator treats non-retryable goose adapter errors as terminal blocked work',
  { concurrency: false },
  async () => {
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
  },
);

test('retry escalation tolerates legacy tasks without fallback_models', { concurrency: false }, () => {
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
