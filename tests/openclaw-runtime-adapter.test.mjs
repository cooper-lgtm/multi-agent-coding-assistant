import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenClawModelResolver,
  buildDemoPlanningFixture,
  buildDirectPlanningFixtureRequest,
  buildExecutionDag,
  createOpenClawPlanningRoleRequest,
  createOpenClawRoleError,
  createOpenClawRoleSuccess,
  createOpenClawWorkerRoleRequest,
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
  assert.equal(envelope.model.logical_model, 'gpt-5.4');
  assert.equal(envelope.model.exact_model_id, 'openai-codex/gpt-5.4');
  assert.equal(envelope.payload.task.task_id, 'task-api-contract');
  assert.equal(envelope.payload.runtime.run_id, 'run-openclaw-adapter-test');
  assert.equal(envelope.payload.repo_path, '/tmp/example-repo');

  const success = createOpenClawRoleSuccess({
    request: envelope,
    summary: 'Implementation completed.',
    output: {
      status: 'implementation_done',
      changed_files: ['src/api/contract.ts'],
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
  assert.equal(error.ok, false);
  assert.equal(error.error.code, 'adapter_unavailable');
  assert.equal(error.error.retryable, true);
});
