import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GooseWorkerAdapter,
  buildGooseProcessArgs,
  buildDemoPlanningFixture,
  buildExecutionDag,
  createOpenClawWorkerRoleRequest,
} from '../dist/index.js';

function buildWorkerRequest(agent = 'backend-agent') {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: `run-goose-adapter-${agent}`,
    availableModels: ['openai-codex/gpt-5.4'],
  });

  const task = Object.values(runtime.tasks).find((candidate) => candidate.assigned_agent === agent);

  if (!task) {
    throw new Error(`Missing fixture task for ${agent}`);
  }

  return createOpenClawWorkerRoleRequest({
    task,
    runtime,
    repoPath: '/tmp/example-repo',
    prompt: {
      prompt_id: `${agent}`,
      prompt_path: `prompts/${agent}.md`,
    },
  });
}

test('goose worker adapter builds invocation from worker request and parses structured output', async () => {
  const request = buildWorkerRequest('backend-agent');
  let receivedInvocation = null;

  const adapter = new GooseWorkerAdapter({
    runGoose: async (invocation) => {
      receivedInvocation = invocation;

      return {
        ok: true,
        exit_code: 0,
        stdout: JSON.stringify({
          status: 'implementation_done',
          summary: 'Implemented API task via goose.',
          changed_files: ['src/api/contract.ts'],
          blocker_category: null,
          blocker_message: null,
          implementation_evidence: ['Updated API contract and handlers.'],
          test_evidence: ['node --test tests/goose-worker-adapter.test.mjs'],
          review_feedback: [],
          commands_run: ['npm run build'],
          test_results: [{ name: 'tests/goose-worker-adapter.test.mjs', status: 'pass' }],
          risk_notes: ['Potential edge-case around retries.'],
          suggested_status: 'implementation_done',
          delivery_metadata: {
            branch_name: 'feat/task3-goose-worker-adapter',
            commit_sha: 'abc1234',
            pr_url: 'https://github.com/example/repo/pull/999',
          },
          prior_attempt: null,
        }),
        stderr: '',
      };
    },
  });

  const result = await adapter.execute(request);

  assert.ok(receivedInvocation);
  assert.equal(receivedInvocation.recipe_path, '.goose/recipes/backend-implementation.yaml');
  assert.equal(receivedInvocation.inputs.task.task_id, request.payload.task.task_id);
  assert.equal(receivedInvocation.inputs.repo_path, request.payload.repo_path);

  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'implementation_done');
  assert.deepEqual(result.output.changed_files, ['src/api/contract.ts']);
  assert.deepEqual(result.output.commands_run, ['npm run build']);
  assert.equal(result.output.delivery_metadata?.branch_name, 'feat/task3-goose-worker-adapter');
});

test('goose worker adapter surfaces blocked when goose reports prerequisites missing', async () => {
  const request = buildWorkerRequest('frontend-agent');

  const adapter = new GooseWorkerAdapter({
    runGoose: async () => ({
      ok: false,
      exit_code: 2,
      stdout: '',
      stderr: 'goose: missing provider credentials',
    }),
  });

  const result = await adapter.execute(request);

  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'blocked');
  assert.equal(result.output.blocker_category, 'environment');
  assert.match(result.output.blocker_message, /missing provider credentials/i);
  assert.equal(result.output.summary, 'Goose execution blocked by missing prerequisites.');
});

test('goose worker adapter treats ENOENT startup failures as blocked environment issues', async () => {
  const request = buildWorkerRequest('backend-agent');

  const adapter = new GooseWorkerAdapter({
    runGoose: async () => ({
      ok: false,
      exit_code: 127,
      stdout: '',
      stderr: 'spawn goose ENOENT',
    }),
  });

  const result = await adapter.execute(request);

  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'blocked');
  assert.equal(result.output.blocker_category, 'environment');
  assert.match(result.output.blocker_message, /ENOENT/i);
});

test('goose worker adapter treats malformed structured output as failed worker evidence', async () => {
  const request = buildWorkerRequest('backend-agent');

  const adapter = new GooseWorkerAdapter({
    runGoose: async () => ({
      ok: true,
      exit_code: 0,
      stdout: 'not-json',
      stderr: '',
    }),
  });

  const result = await adapter.execute(request);

  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'failed');
  assert.equal(result.output.blocker_category, 'unknown');
  assert.match(result.output.blocker_message, /not valid structured worker output/i);
  assert.match(result.output.implementation_evidence.at(-1), /not-json/);
});

test('goose worker adapter rejects structured output with invalid field types', async () => {
  const request = buildWorkerRequest('backend-agent');

  const adapter = new GooseWorkerAdapter({
    runGoose: async () => ({
      ok: true,
      exit_code: 0,
      stdout: JSON.stringify({
        status: 'implementation_done',
        summary: 'Goose claims implementation completed.',
        changed_files: 'src/api/contract.ts',
        implementation_evidence: 'Updated the contract.',
        commands_run: 'npm run build',
      }),
      stderr: '',
    }),
  });

  const result = await adapter.execute(request);

  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'failed');
  assert.equal(result.output.blocker_category, 'unknown');
  assert.match(result.output.blocker_message, /not valid structured worker output/i);
});

test('buildGooseProcessArgs serializes recipe inputs as goose params', () => {
  const args = buildGooseProcessArgs({
    recipe_path: '.goose/recipes/backend-implementation.yaml',
    output_schema_path: '.goose/recipes/shared/worker-output-schema.json',
    inputs: {
      run_id: 'run-123',
      repo_path: '/tmp/example-repo',
      task: {
        task_id: 'task-api-contract',
        acceptance_criteria: ['Ship typed API contract'],
      },
      retry_context: null,
    },
  });

  assert.deepEqual(args, [
    'run',
    '--recipe',
    '.goose/recipes/backend-implementation.yaml',
    '--quiet',
    '--no-session',
    '--params',
    'run_id=run-123',
    '--params',
    'repo_path=/tmp/example-repo',
    '--params',
    'task={"task_id":"task-api-contract","acceptance_criteria":["Ship typed API contract"]}',
    '--params',
    'retry_context=null',
  ]);
});
