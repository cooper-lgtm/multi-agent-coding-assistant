import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RetryEscalationManager,
  buildDemoPlanningFixture,
  buildExecutionDag,
  createWorkerExecutionContext,
  createWorkerRetryHandoff,
} from '../dist/index.js';

function buildRetryTask() {
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), {
    runId: 'run-retry-diagnostics',
    availableModels: ['codex', 'claude'],
  });

  return runtime.tasks['task-api-contract'];
}

test('worker retry context preserves bounded attempt history and structured diagnosis fields', () => {
  const firstAttempt = createWorkerRetryHandoff(
    {
      changed_files: ['src/api/contract.ts'],
      blocker_category: 'quality',
      blocker_message: 'Review requested changes before approval.',
      failure_category: 'quality_needs_fix',
      failure_diagnosis: 'Review feedback repeated the same null-handling gap.',
      reconsider_instructions: [
        'Audit the failing review thread before changing code again.',
      ],
      repeated_pattern_summary: null,
    },
    1,
    'needs_fix',
    'Review requested another implementation pass.',
  );
  const secondAttempt = createWorkerRetryHandoff(
    {
      changed_files: ['src/api/contract.ts'],
      blocker_category: 'quality',
      blocker_message: 'Review still requested the same changes.',
      failure_category: 'quality_needs_fix',
      failure_diagnosis: 'The second pass replayed the same edit without new tests.',
      reconsider_instructions: [
        'Add focused regression coverage before touching the same file again.',
      ],
      repeated_pattern_summary: 'Attempts 1 and 2 ended with the same review blocker on the same file set.',
    },
    2,
    'needs_fix',
    'Review still requests the same changes.',
  );

  const context = createWorkerExecutionContext({
    failure_category: 'quality_needs_fix',
    failure_diagnosis: 'The most recent retry repeated the same review blocker.',
    reconsider_instructions: [
      'Stop replaying the same patch and add focused regression evidence first.',
    ],
    repeated_pattern_summary: 'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
    attempt_history: [
      { attempt: 0, status: 'failed', summary: 'Too old and should be truncated.' },
      firstAttempt,
      secondAttempt,
    ],
  });

  assert.equal(context.failure_category, 'quality_needs_fix');
  assert.equal(
    context.failure_diagnosis,
    'The most recent retry repeated the same review blocker.',
  );
  assert.deepEqual(context.reconsider_instructions, [
    'Stop replaying the same patch and add focused regression evidence first.',
  ]);
  assert.equal(
    context.repeated_pattern_summary,
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
  );
  assert.equal(context.attempt_history.length, 2);
  assert.deepEqual(
    context.attempt_history.map((attempt) => attempt.attempt),
    [1, 2],
  );
  assert.equal(context.attempt_history[1].failure_category, 'quality_needs_fix');
  assert.equal(
    context.attempt_history[1].repeated_pattern_summary,
    'Attempts 1 and 2 ended with the same review blocker on the same file set.',
  );
});

test('retry escalation decisions can reference repeated-pattern diagnosis beyond the last summary string', () => {
  const task = buildRetryTask();
  const retryManager = new RetryEscalationManager({ availableModels: ['codex', 'claude'] });

  task.retry_count = 1;
  task.failure_category = 'quality_needs_fix';
  task.failure_diagnosis = 'The previous retry replayed the same review fix without new evidence.';
  task.reconsider_instructions = [
    'Change approach before editing: add regression coverage and revisit the review thread.',
  ];
  task.repeated_pattern_summary =
    'Attempts 1 and 2 hit the same review blocker on src/api/contract.ts with unchanged verification evidence.';
  task.attempt_history = [
    createWorkerRetryHandoff(
      {
        changed_files: ['src/api/contract.ts'],
        blocker_category: 'quality',
        blocker_message: 'Review requested broader fixture coverage.',
        failure_category: 'quality_needs_fix',
        failure_diagnosis: 'The first pass omitted the requested fixture coverage.',
        reconsider_instructions: ['Add broader fixture coverage before another retry.'],
        repeated_pattern_summary: null,
      },
      1,
      'needs_fix',
      'Review requested broader fixture coverage.',
    ),
    createWorkerRetryHandoff(
      {
        changed_files: ['src/api/contract.ts'],
        blocker_category: 'quality',
        blocker_message: 'Review still requested broader fixture coverage.',
        failure_category: 'quality_needs_fix',
        failure_diagnosis: 'The second pass changed the same file without new fixture coverage.',
        reconsider_instructions: ['Change approach before editing the same file again.'],
        repeated_pattern_summary:
          'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
      },
      2,
      'needs_fix',
      'Review still requested broader fixture coverage.',
    ),
  ];

  const decision = retryManager.decide(task, 'quality_needs_fix');

  assert.equal(decision.action, 'retry_with_upgraded_model');
  assert.equal(decision.next_model, 'claude');
  assert.match(
    decision.reason,
    /same review blocker/i,
  );
});
