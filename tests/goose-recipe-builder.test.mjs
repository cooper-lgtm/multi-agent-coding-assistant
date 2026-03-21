import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildGooseRecipeExecution,
  buildDemoPlanningFixture,
  buildExecutionDag,
} from '../dist/index.js';

function readRequiredFields(recipePath) {
  const content = fs.readFileSync(recipePath, 'utf8');
  const lines = content.split('\n');
  const requiredFields = [];
  let inRequiredBlock = false;

  for (const line of lines) {
    if (!inRequiredBlock) {
      if (line.trim() === 'required:') {
        inRequiredBlock = true;
      }

      continue;
    }

    const fieldMatch = line.match(/^\s*-\s+(.+?)\s*$/);

    if (fieldMatch) {
      requiredFields.push(fieldMatch[1]);
      continue;
    }

    if (line.trim() !== '' && !line.startsWith('      ')) {
      break;
    }
  }

  return requiredFields;
}

function isMachineSpecificPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))
  );
}

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

test('committed repo context keeps repo_path portable across clones', () => {
  const context = JSON.parse(fs.readFileSync('docs/context/repo-context.json', 'utf8'));

  assert.ok(
    !Object.hasOwn(context, 'repo_path') || !isMachineSpecificPath(context.repo_path),
    `Expected repo_path to stay portable, received ${context.repo_path}`,
  );
});

test('committed repo context records automatic codex review workflow', () => {
  const context = JSON.parse(fs.readFileSync('docs/context/repo-context.json', 'utf8'));

  assert.ok(!Object.hasOwn(context.workflow, 'required_review_comment'));
  assert.match(context.workflow.review_trigger, /automatic Codex review/i);
});

test('execute-next-plan-task does not require branch or pr metadata for blocked runs', () => {
  const requiredFields = readRequiredFields('.goose/recipes/execute-next-plan-task.yaml');

  assert.ok(!requiredFields.includes('branch_name'));
  assert.ok(!requiredFields.includes('pr_url'));
  assert.deepEqual(requiredFields, [
    'status',
    'selected_task',
    'merge_status',
    'changed_files',
    'validation_commands',
  ]);
});

test('execute-next-plan-task relies on automatic codex review workflow', () => {
  const recipe = fs.readFileSync('.goose/recipes/execute-next-plan-task.yaml', 'utf8');

  assert.ok(!recipe.includes('@codex review'));
  assert.match(recipe, /automatic Codex review/i);
});

test('execute-next-plan-task refreshes checked-in context before merge', () => {
  const recipe = fs.readFileSync('.goose/recipes/execute-next-plan-task.yaml', 'utf8');
  const refreshIndex = recipe.indexOf('refresh the repository context artifacts on the task branch');
  const mergeIndex = recipe.indexOf('merge without waiting for the automatic Codex review workflow to finish');

  assert.notEqual(refreshIndex, -1);
  assert.notEqual(mergeIndex, -1);
  assert.ok(refreshIndex < mergeIndex, 'Expected context refresh step to occur before merge.');
  assert.match(recipe, /include those updates in the same PR before merge/i);
});

test('implementation recipes use goose-compatible instruction blocks', () => {
  for (const recipePath of [
    '.goose/recipes/frontend-implementation.yaml',
    '.goose/recipes/backend-implementation.yaml',
  ]) {
    const recipe = fs.readFileSync(recipePath, 'utf8');

    assert.match(recipe, /^instructions:\s*\|/m);
  }
});
