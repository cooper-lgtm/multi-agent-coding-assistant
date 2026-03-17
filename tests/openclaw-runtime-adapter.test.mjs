import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenClawModelResolver,
  buildDemoPlanningFixture,
  buildDirectPlanningFixtureRequest,
  buildExecutionDag,
  createOpenClawWorkerRoleRequest,
  createOpenClawPlanningRoleRequest,
  createOpenClawRoleError,
  createOpenClawRoleSuccess,
} from '../dist/index.js';

test('planning role request envelope standardizes planning payloads and model metadata', () => {
  const resolver = new OpenClawModelResolver();
  const planningRequest = buildDirectPlanningFixtureRequest();

  const envelope = createOpenClawPlanningRoleRequest({
    role: 'planning-agent',
    request: planningRequest,
    resolvedMode: 'direct',
    model: resolver.resolve('claude'),
    prompt: {
      prompt_id: 'planning-agent.system',
      prompt_path: 'prompts/planning-agent.system.md',
    },
  });

  assert.equal(envelope.role_type, 'planning');
  assert.equal(envelope.role, 'planning-agent');
  assert.equal(envelope.model.logical_model, 'claude');
  assert.equal(envelope.model.exact_model_id, 'anthropic/claude-opus-4-6');
  assert.equal(envelope.payload.request, planningRequest.request);
  assert.equal(envelope.payload.planning_mode, 'direct');
  assert.deepEqual(envelope.payload.constraints, planningRequest.constraints);
  assert.equal(envelope.prompt.prompt_path, 'prompts/planning-agent.system.md');
});

test('worker role envelopes standardize task payloads plus success and error responses', () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-openclaw-adapter-test',
    availableModels: ['openai-codex/gpt-5.4'],
  });
  const task = runtime.tasks['task-api-contract'];

  assert.equal(task.model_metadata?.exact_model_id, 'openai-codex/gpt-5.4');

  const envelope = createOpenClawWorkerRoleRequest({
    task,
    runtime,
    repoPath: '/tmp/example-repo',
    prompt: {
      prompt_id: 'backend-agent',
      prompt_path: 'prompts/backend-agent.md',
    },
  });

  assert.equal(envelope.role_type, 'worker');
  assert.equal(envelope.role, 'backend-agent');
  assert.equal(envelope.model.logical_model, 'codex');
  assert.equal(envelope.model.exact_model_id, 'openai-codex/gpt-5.4');
  assert.equal(envelope.payload.task.task_id, 'task-api-contract');
  assert.equal(envelope.payload.runtime.run_id, 'run-openclaw-adapter-test');
  assert.equal(envelope.payload.repo_path, '/tmp/example-repo');
  assert.deepEqual(envelope.payload.changed_files, []);
  assert.equal(envelope.payload.blocker_category, null);
  assert.equal(envelope.payload.blocker_message, null);
  assert.deepEqual(envelope.payload.implementation_evidence, []);
  assert.deepEqual(envelope.payload.test_evidence, []);
  assert.deepEqual(envelope.payload.review_feedback, []);
  assert.deepEqual(envelope.payload.commands_run, []);
  assert.deepEqual(envelope.payload.test_results, []);
  assert.deepEqual(envelope.payload.risk_notes, []);
  assert.equal(envelope.payload.suggested_status, null);
  assert.equal(envelope.payload.delivery_metadata, null);
  assert.equal(envelope.payload.prior_attempt, null);

  const success = createOpenClawRoleSuccess({
    request: envelope,
    summary: 'Implementation completed.',
    output: {
      status: 'implementation_done',
      changed_files: ['src/api/contract.ts'],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: ['Updated the contract to match the fixture.'],
      test_evidence: [],
      review_feedback: [],
      commands_run: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
      test_results: [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }],
      risk_notes: ['Broaden worker-role adapter coverage for retry handoffs.'],
      suggested_status: 'implementation_done',
      delivery_metadata: {
        branch_name: 'feat/goose-worker-contracts',
        commit_sha: 'deadbeef',
        pr_url: 'https://github.com/example/repo/pull/123',
      },
      prior_attempt: null,
    },
  });

  const error = createOpenClawRoleError({
    request: envelope,
    code: 'adapter_unavailable',
    message: 'No OpenClaw session is available.',
    retryable: true,
  });

  assert.equal(success.ok, true);
  assert.equal(success.model.exact_model_id, 'openai-codex/gpt-5.4');
  assert.equal(success.output.status, 'implementation_done');
  assert.deepEqual(success.output.changed_files, ['src/api/contract.ts']);
  assert.deepEqual(success.output.implementation_evidence, [
    'Updated the contract to match the fixture.',
  ]);
  assert.deepEqual(success.output.commands_run, [
    'npm run build',
    'node --test tests/openclaw-runtime-adapter.test.mjs',
  ]);
  assert.deepEqual(success.output.test_results, [
    { name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' },
  ]);
  assert.deepEqual(success.output.risk_notes, [
    'Broaden worker-role adapter coverage for retry handoffs.',
  ]);
  assert.equal(success.output.suggested_status, 'implementation_done');
  assert.equal(success.output.delivery_metadata?.pr_url, 'https://github.com/example/repo/pull/123');
  assert.equal(error.ok, false);
  assert.equal(error.error.code, 'adapter_unavailable');
  assert.equal(error.error.retryable, true);
});

test('worker role envelopes preserve retry handoff context for quality gate roles', () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-openclaw-quality-gate-test',
    availableModels: ['openai-codex/gpt-5.4', 'anthropic/claude-opus-4-6'],
  });
  const task = runtime.tasks['task-api-contract'];

  task.changed_files = ['src/api/contract.ts'];
  task.blocker_category = 'quality';
  task.blocker_message = 'Previous review requested changes before approval.';
  task.implementation_evidence = ['Contract types now compile for downstream callers.'];
  task.test_evidence = ['npm run test:adapter passed locally on the previous attempt.'];
  task.review_feedback = ['Review flagged missing edge-case coverage.'];
  task.commands_run = ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'];
  task.test_results = [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }];
  task.risk_notes = ['One edge-case fixture still needs broader coverage.'];
  task.suggested_status = 'needs_fix';
  task.delivery_metadata = {
    branch_name: 'feat/goose-worker-contracts',
    commit_sha: 'deadbeef',
    pr_url: 'https://github.com/example/repo/pull/123',
  };
  task.prior_attempt = {
    attempt: 1,
    status: 'needs_fix',
    summary: 'Review requested changes after the first quality-gate pass.',
    changed_files: ['src/api/contract.ts'],
    blocker_category: 'quality',
    blocker_message: 'Previous review requested changes before approval.',
    implementation_evidence: ['Contract types now compile for downstream callers.'],
    test_evidence: ['npm run test:adapter passed locally on the previous attempt.'],
    review_feedback: ['Review flagged missing edge-case coverage.'],
    commands_run: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
    test_results: [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }],
    risk_notes: ['One edge-case fixture still needs broader coverage.'],
    suggested_status: 'needs_fix',
    delivery_metadata: {
      branch_name: 'feat/goose-worker-contracts',
      commit_sha: 'deadbeef',
      pr_url: 'https://github.com/example/repo/pull/123',
    },
  };

  const envelope = createOpenClawWorkerRoleRequest({
    task,
    runtime,
    role: 'test-agent',
    model: 'codex',
    repoPath: '/tmp/example-repo',
    prompt: {
      prompt_id: 'test-agent',
      prompt_path: 'prompts/test-agent.md',
    },
  });

  assert.equal(envelope.role, 'test-agent');
  assert.deepEqual(envelope.payload.changed_files, ['src/api/contract.ts']);
  assert.equal(envelope.payload.blocker_category, 'quality');
  assert.equal(envelope.payload.blocker_message, 'Previous review requested changes before approval.');
  assert.deepEqual(envelope.payload.implementation_evidence, [
    'Contract types now compile for downstream callers.',
  ]);
  assert.deepEqual(envelope.payload.test_evidence, [
    'npm run test:adapter passed locally on the previous attempt.',
  ]);
  assert.deepEqual(envelope.payload.review_feedback, [
    'Review flagged missing edge-case coverage.',
  ]);
  assert.deepEqual(envelope.payload.commands_run, [
    'npm run build',
    'node --test tests/openclaw-runtime-adapter.test.mjs',
  ]);
  assert.deepEqual(envelope.payload.test_results, [
    { name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' },
  ]);
  assert.deepEqual(envelope.payload.risk_notes, [
    'One edge-case fixture still needs broader coverage.',
  ]);
  assert.equal(envelope.payload.suggested_status, 'needs_fix');
  assert.equal(envelope.payload.delivery_metadata?.branch_name, 'feat/goose-worker-contracts');
  assert.equal(envelope.payload.prior_attempt?.attempt, 1);
  assert.equal(envelope.payload.prior_attempt?.status, 'needs_fix');
});
