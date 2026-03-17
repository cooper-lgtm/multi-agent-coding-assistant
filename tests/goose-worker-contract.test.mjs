import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkerExecutionContext,
  createWorkerRetryHandoff,
  createWorkerExecutionOutput,
  createOpenClawRoleSuccess,
  createOpenClawWorkerRoleRequest,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

test('worker execution context defaults goose evidence fields when absent', () => {
  const context = createWorkerExecutionContext({
    changed_files: ['src/example.ts'],
  });

  assert.deepEqual(context.changed_files, ['src/example.ts']);
  assert.deepEqual(context.commands_run, []);
  assert.deepEqual(context.test_results, []);
  assert.deepEqual(context.risk_notes, []);
  assert.equal(context.suggested_status, null);
  assert.equal(context.delivery_metadata, null);
});

test('retry handoff and execution output preserve goose evidence payloads', () => {
  const handoff = createWorkerRetryHandoff(
    {
      changed_files: ['src/a.ts'],
      commands_run: ['npm run build', 'node --test tests/a.test.mjs'],
      test_results: [{ name: 'tests/a.test.mjs', status: 'pass', details: 'ok' }],
      risk_notes: ['Edge-case behavior still needs broader fixture coverage.'],
      suggested_status: 'needs_fix',
      delivery_metadata: {
        branch_name: 'feat/example',
        commit_sha: 'abc1234',
        pr_url: 'https://github.com/example/repo/pull/1',
      },
    },
    2,
    'needs_fix',
    'Quality feedback requested another implementation pass.',
  );

  assert.deepEqual(handoff.commands_run, ['npm run build', 'node --test tests/a.test.mjs']);
  assert.deepEqual(handoff.test_results, [{ name: 'tests/a.test.mjs', status: 'pass', details: 'ok' }]);
  assert.deepEqual(handoff.risk_notes, ['Edge-case behavior still needs broader fixture coverage.']);
  assert.equal(handoff.suggested_status, 'needs_fix');
  assert.equal(handoff.delivery_metadata?.branch_name, 'feat/example');

  const output = createWorkerExecutionOutput({
    context: handoff,
    status: 'implementation_done',
    summary: 'Implementation finished with structured evidence.',
  });

  assert.equal(output.status, 'implementation_done');
  assert.equal(output.summary, 'Implementation finished with structured evidence.');
  assert.deepEqual(output.commands_run, ['npm run build', 'node --test tests/a.test.mjs']);
  assert.equal(output.delivery_metadata?.pr_url, 'https://github.com/example/repo/pull/1');
});

test('worker role success envelope accepts implementation goose evidence while remaining optional', () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-goose-contract-success',
    availableModels: ['openai-codex/gpt-5.4'],
  });
  const task = runtime.tasks['task-api-contract'];

  const request = createOpenClawWorkerRoleRequest({
    task,
    runtime,
    repoPath: '/tmp/example-repo',
    prompt: {
      prompt_id: 'backend-agent',
      prompt_path: 'prompts/backend-agent.md',
    },
  });

  const enriched = createOpenClawRoleSuccess({
    request,
    summary: 'Goose implementation completed.',
    output: {
      status: 'implementation_done',
      changed_files: ['src/api/contract.ts'],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: ['Implemented API contract updates.'],
      test_evidence: [],
      review_feedback: [],
      prior_attempt: null,
      commands_run: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
      test_results: [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }],
      risk_notes: ['Follow-up: broaden contract fixture assertions in integration tests.'],
      suggested_status: 'implementation_done',
      delivery_metadata: {
        branch_name: 'feat/goose-worker-contracts',
        commit_sha: 'deadbeef',
        pr_url: 'https://github.com/example/repo/pull/123',
      },
    },
  });

  assert.equal(enriched.ok, true);
  assert.deepEqual(enriched.output.commands_run, [
    'npm run build',
    'node --test tests/openclaw-runtime-adapter.test.mjs',
  ]);
  assert.deepEqual(enriched.output.test_results, [
    { name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' },
  ]);
  assert.deepEqual(enriched.output.risk_notes, [
    'Follow-up: broaden contract fixture assertions in integration tests.',
  ]);
  assert.equal(enriched.output.suggested_status, 'implementation_done');
  assert.equal(enriched.output.delivery_metadata?.branch_name, 'feat/goose-worker-contracts');

  const minimal = createOpenClawRoleSuccess({
    request,
    summary: 'Legacy mock output still supported.',
    output: {
      status: 'implementation_done',
      changed_files: ['src/api/contract.ts'],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: ['Minimal output remains valid.'],
      test_evidence: [],
      review_feedback: [],
      prior_attempt: null,
    },
  });

  assert.equal(minimal.ok, true);
  assert.equal(minimal.output.commands_run, undefined);
  assert.equal(minimal.output.test_results, undefined);
  assert.equal(minimal.output.risk_notes, undefined);
  assert.equal(minimal.output.suggested_status, undefined);
  assert.equal(minimal.output.delivery_metadata, undefined);
});
