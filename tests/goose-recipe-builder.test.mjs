import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGooseRecipeExecution,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

function buildTask(agent) {
  const fixture = buildDemoPlanningFixture();
  const { runtime } = buildExecutionDag(fixture, {
    runId: `run-${agent}`,
    availableModels: ['openai-codex/gpt-5.4'],
  });

  const task = Object.values(runtime.tasks).find((candidate) => candidate.assigned_agent === agent);

  if (!task) {
    throw new Error(`Missing fixture task for ${agent}`);
  }

  return task;
}

test('buildGooseRecipeExecution maps frontend-agent to frontend recipe', () => {
  const task = buildTask('frontend-agent');

  const spec = buildGooseRecipeExecution({
    role: 'frontend-agent',
    task,
    runtimeRunId: 'run-frontend',
    repoPath: '/tmp/repo',
    retryContext: null,
  });

  assert.equal(spec.recipe_path, '.goose/recipes/frontend-implementation.yaml');
  assert.equal(spec.output_schema_path, '.goose/recipes/shared/worker-output-schema.json');
  assert.equal(spec.inputs.repo_path, '/tmp/repo');
  assert.equal(spec.inputs.task.task_id, task.task_id);
  assert.deepEqual(spec.inputs.task.acceptance_criteria, task.acceptance_criteria);
  assert.equal(spec.inputs.retry_context, null);
});

test('buildGooseRecipeExecution maps backend-agent to backend recipe and passes retry context', () => {
  const task = buildTask('backend-agent');

  const spec = buildGooseRecipeExecution({
    role: 'backend-agent',
    task,
    runtimeRunId: 'run-backend',
    repoPath: '/tmp/repo',
    retryContext: {
      attempt: 2,
      status: 'needs_fix',
      summary: 'Address review feedback on validation flow.',
      changed_files: ['src/orchestrator/main-orchestrator.ts'],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: ['Updated retry routing.'],
      test_evidence: ['node --test tests/orchestrator-runtime.test.mjs'],
      review_feedback: ['Please tighten null-handling around retry state.'],
      commands_run: ['npm run build'],
      test_results: [{ name: 'tests/orchestrator-runtime.test.mjs', status: 'pass' }],
      risk_notes: ['Potential hidden edge-cases in nested dependencies.'],
      suggested_status: 'implementation_done',
      delivery_metadata: null,
    },
  });

  assert.equal(spec.recipe_path, '.goose/recipes/backend-implementation.yaml');
  assert.equal(spec.inputs.retry_context?.attempt, 2);
  assert.deepEqual(spec.inputs.retry_context?.review_feedback, [
    'Please tighten null-handling around retry state.',
  ]);
  assert.deepEqual(spec.inputs.task.acceptance_criteria, task.acceptance_criteria);
});
