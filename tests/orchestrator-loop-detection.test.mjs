import test from 'node:test';
import assert from 'node:assert/strict';

import * as runtimeModule from '../dist/index.js';

const {
  MainOrchestrator,
  MockImplementationDispatcher,
  MockQualityGateRunner,
  InMemoryRunStore,
  RetryEscalationManager,
  ReportingManager,
  buildDemoPlanningFixture,
  createLoopDetectionMiddleware,
} = runtimeModule;

function buildSingleTaskPlanningFixture() {
  const fixture = buildDemoPlanningFixture();

  return {
    ...fixture,
    tasks: [structuredClone(fixture.tasks[0])],
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
      failure_category: task.failure_category,
      failure_diagnosis: task.failure_diagnosis,
      reconsider_instructions: [...(task.reconsider_instructions ?? [])],
      repeated_pattern_summary: task.repeated_pattern_summary,
      attempt_history: structuredClone(task.attempt_history ?? []),
    });

    return this.inner.dispatch(task, runtime);
  }
}

test('loop detection injects reconsideration guidance before a third low-yield retry and records an event', async () => {
  const fixture = buildSingleTaskPlanningFixture();
  const implementationCalls = [];

  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: new RecordingImplementationDispatcher(
      new MockImplementationDispatcher({
        taskDecisions: {
          'task-api-contract': [
            {
              status: 'failed',
              summary: 'Attempt 1 repeated the same review blocker.',
              changed_files: ['src/api/contract.ts'],
              blocker_category: 'quality',
              blocker_message: 'Review requested broader fixture coverage.',
              commands_run: ['npm run build'],
              test_evidence: [],
              review_feedback: ['Review requested broader fixture coverage.'],
            },
            {
              status: 'failed',
              summary: 'Attempt 2 repeated the same review blocker.',
              changed_files: ['src/api/contract.ts'],
              blocker_category: 'quality',
              blocker_message: 'Review requested broader fixture coverage.',
              commands_run: ['npm run build'],
              test_evidence: [],
              review_feedback: ['Review requested broader fixture coverage.'],
            },
            {
              status: 'implementation_done',
              summary: 'Attempt 3 changed approach after loop detection guidance.',
              changed_files: ['src/api/contract.ts', 'tests/api-contract.test.mjs'],
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
    runtimeMiddleware: [createLoopDetectionMiddleware()],
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
  assert.equal(implementationCalls[2].failure_category, 'implementation_failed');
  assert.equal(implementationCalls[2].attempt_history.length, 2);
  assert.match(
    implementationCalls[2].repeated_pattern_summary ?? '',
    /same review blocker/i,
  );
  assert.ok(
    implementationCalls[2].reconsider_instructions.some((instruction) =>
      /change approach/i.test(instruction),
    ),
  );
  const loopEvent = result.runtime.events.find((event) => event.type === 'retry_loop_detected');
  assert.ok(loopEvent);
  assert.equal(loopEvent.phase, 'retry');
  assert.equal(loopEvent.attempt, 3);
  assert.equal(loopEvent.task_id, 'task-api-contract');
  assert.equal(loopEvent.task_status, 'pending');
  assert.equal(loopEvent.failure_category, 'implementation_failed');
  assert.equal(loopEvent.model?.selected_model, 'claude');
  assert.deepEqual(loopEvent.metadata.repeated_attempts, [1, 2]);
  assert.match(
    result.summary.events.join('\n'),
    /retry loop detected/i,
  );
});
