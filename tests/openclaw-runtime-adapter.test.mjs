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

test('planning role request envelope standardizes planning payloads and model metadata', { concurrency: false }, () => {
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

test(
  'worker role envelopes standardize task payloads plus success and error responses',
  { concurrency: false },
  () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-openclaw-adapter-test',
    availableModels: ['openai-codex/gpt-5.4'],
  });
  const task = runtime.tasks['task-api-contract'];
  const repoPath = process.cwd();

  task.execution_guidance = {
    must_read_files: [
      'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
      'docs/plans/2026-04-01-goose-plan-linked-docs.md',
      'README.md',
    ],
    verification_commands: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
    environment_checks: ['git status --short'],
    definition_of_done: ['Worker payload includes compact runtime context for implementation.'],
    reconsider_signals: ['Verification plan is missing from the worker payload.'],
  };

  assert.equal(task.model_metadata?.exact_model_id, 'openai-codex/gpt-5.4');

  const envelope = createOpenClawWorkerRoleRequest({
    task,
    runtime,
    repoPath,
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
  assert.equal(envelope.payload.repo_path, repoPath);
  assert.deepEqual(envelope.payload.changed_files, []);
  assert.equal(envelope.payload.blocker_category, null);
  assert.equal(envelope.payload.blocker_message, null);
  assert.equal(envelope.payload.failure_category, null);
  assert.equal(envelope.payload.failure_diagnosis, null);
  assert.deepEqual(envelope.payload.reconsider_instructions, []);
  assert.equal(envelope.payload.repeated_pattern_summary, null);
  assert.deepEqual(envelope.payload.implementation_evidence, []);
  assert.deepEqual(envelope.payload.test_evidence, []);
  assert.deepEqual(envelope.payload.review_feedback, []);
  assert.deepEqual(envelope.payload.commands_run, []);
  assert.deepEqual(envelope.payload.test_results, []);
  assert.deepEqual(envelope.payload.risk_notes, []);
  assert.equal(envelope.payload.suggested_status, null);
  assert.equal(envelope.payload.delivery_metadata, null);
  assert.equal(envelope.payload.prior_attempt, null);
  assert.deepEqual(envelope.payload.attempt_history, []);
  assert.ok(envelope.payload.runtime_context);
  assert.ok(envelope.payload.runtime_context.repo_context_summary.length > 0);
  assert.equal(envelope.payload.runtime_context.environment_snapshot.package_manager, 'npm');
  assert.equal(envelope.payload.runtime_context.environment_snapshot.package_manifest_path, 'package.json');
  assert.equal(envelope.payload.runtime_context.environment_snapshot.lockfile_path, 'package-lock.json');
  assert.deepEqual(envelope.payload.runtime_context.task_context_files, [
    'docs/context/repo-context.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs.md',
    'README.md',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.commands, [
    'npm run build',
    'node --test tests/openclaw-runtime-adapter.test.mjs',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.environment_checks, [
    'git status --short',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.definition_of_done, [
    'Worker payload includes compact runtime context for implementation.',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.reconsider_signals, [
    'Verification plan is missing from the worker payload.',
  ]);
  assert.equal(envelope.payload.runtime_context.verification_plan.retry_handoff, null);
  assert.match(envelope.payload.runtime_context.time_budget_hint, /Attempt 1 of 3/u);

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
  },
);

test('worker role envelopes preserve retry handoff context for quality gate roles', { concurrency: false }, () => {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: 'run-openclaw-quality-gate-test',
    availableModels: ['openai-codex/gpt-5.4', 'anthropic/claude-opus-4-6'],
  });
  const task = runtime.tasks['task-api-contract'];
  const repoPath = process.cwd();

  task.execution_guidance = {
    must_read_files: [
      'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
      'docs/plans/2026-04-01-goose-plan-linked-docs.md',
      'README.md',
    ],
    verification_commands: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
    environment_checks: ['git status --short'],
    definition_of_done: ['Quality gate worker can inspect compact retry handoff context.'],
    reconsider_signals: ['Review feedback is not visible to the next attempt.'],
  };
  task.changed_files = ['src/api/contract.ts'];
  task.blocker_category = 'quality';
  task.blocker_message = 'Previous review requested changes before approval.';
  task.failure_category = 'quality_needs_fix';
  task.failure_diagnosis = 'Previous review feedback still requires broader edge-case coverage.';
  task.reconsider_instructions = [
    'Read the review feedback before editing the same contract again.',
    'Add the missing edge-case coverage before requesting another review.',
  ];
  task.repeated_pattern_summary =
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.';
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
    failure_category: 'quality_needs_fix',
    failure_diagnosis: 'Previous review feedback still requires broader edge-case coverage.',
    reconsider_instructions: [
      'Read the review feedback before editing the same contract again.',
      'Add the missing edge-case coverage before requesting another review.',
    ],
    repeated_pattern_summary:
      'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
    checklist_feedback: ['Missing verification evidence for required command: npm run test:adapter'],
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
  task.attempt_history = [structuredClone(task.prior_attempt)];

  const envelope = createOpenClawWorkerRoleRequest({
    task,
    runtime,
    role: 'test-agent',
    model: 'codex',
    repoPath,
    prompt: {
      prompt_id: 'test-agent',
      prompt_path: 'prompts/test-agent.md',
    },
  });

  assert.equal(envelope.role, 'test-agent');
  assert.deepEqual(envelope.payload.changed_files, ['src/api/contract.ts']);
  assert.equal(envelope.payload.blocker_category, 'quality');
  assert.equal(envelope.payload.blocker_message, 'Previous review requested changes before approval.');
  assert.equal(envelope.payload.failure_category, 'quality_needs_fix');
  assert.equal(
    envelope.payload.failure_diagnosis,
    'Previous review feedback still requires broader edge-case coverage.',
  );
  assert.deepEqual(envelope.payload.reconsider_instructions, [
    'Read the review feedback before editing the same contract again.',
    'Add the missing edge-case coverage before requesting another review.',
  ]);
  assert.equal(
    envelope.payload.repeated_pattern_summary,
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
  );
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
  assert.equal(envelope.payload.attempt_history.length, 1);
  assert.deepEqual(envelope.payload.prior_attempt?.checklist_feedback, [
    'Missing verification evidence for required command: npm run test:adapter',
  ]);
  assert.ok(envelope.payload.runtime_context);
  assert.deepEqual(envelope.payload.runtime_context.task_context_files, [
    'docs/context/repo-context.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs-design.md',
    'docs/plans/2026-04-01-goose-plan-linked-docs.md',
    'README.md',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.commands, [
    'npm run build',
    'node --test tests/openclaw-runtime-adapter.test.mjs',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.reconsider_signals, [
    'Review feedback is not visible to the next attempt.',
    'Read the review feedback before editing the same contract again.',
    'Add the missing edge-case coverage before requesting another review.',
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
    'Prior attempt 1 ended as needs_fix: Review requested changes after the first quality-gate pass.',
    'Previous blocker: Previous review requested changes before approval.',
    'Previous diagnosis: Previous review feedback still requires broader edge-case coverage.',
  ]);
  assert.deepEqual(envelope.payload.runtime_context.verification_plan.retry_handoff, {
    attempt: 1,
    status: 'needs_fix',
    summary: 'Review requested changes after the first quality-gate pass.',
    blocker_category: 'quality',
    blocker_message: 'Previous review requested changes before approval.',
    failure_category: 'quality_needs_fix',
    failure_diagnosis: 'Previous review feedback still requires broader edge-case coverage.',
    reconsider_instructions: [
      'Read the review feedback before editing the same contract again.',
      'Add the missing edge-case coverage before requesting another review.',
    ],
    repeated_pattern_summary:
      'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
    checklist_feedback: ['Missing verification evidence for required command: npm run test:adapter'],
    commands_run: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
    review_feedback: ['Review flagged missing edge-case coverage.'],
  });
  assert.equal(envelope.payload.runtime.retry_count, 1);
  assert.equal(envelope.metadata.attempt, 2);
});
