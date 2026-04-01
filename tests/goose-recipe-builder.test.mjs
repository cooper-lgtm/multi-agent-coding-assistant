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
  task.failure_category = 'verification_incomplete';
  task.failure_diagnosis = 'The previous continuation skipped required verification commands.';
  task.reconsider_instructions = ['Run the missing verification commands before another handoff.'];
  task.repeated_pattern_summary = null;
  task.attempt_history = [];
  const runtimeContext = {
    repo_context_summary: [
      'Planning/runtime tasks now preserve compact execution_guidance fields through normalization, validation, and DAG/runtime task creation.',
    ],
    environment_snapshot: {
      package_manager: 'npm',
      package_manifest_path: 'package.json',
      lockfile_path: 'package-lock.json',
      build_command: 'npm run build',
      test_commands: ['npm run test:runtime'],
    },
    task_context_files: ['docs/context/repo-context.md', 'README.md', 'prompts/frontend-agent.md'],
    verification_plan: {
      commands: ['npm run build', 'npm run test:runtime'],
      environment_checks: ['git status --short'],
      definition_of_done: ['Frontend worker follows injected runtime context before editing.'],
      reconsider_signals: ['Frontend goose recipe lost verification guidance.'],
      retry_handoff: null,
    },
    time_budget_hint: 'Attempt 1 of 3; 2 retries remain after this pass.',
  };

  const spec = buildGooseRecipeExecution({
    role: 'frontend-agent',
    task,
    runtimeRunId: 'run-frontend',
    repoPath: '/tmp/repo',
    retryContext: null,
    runtimeContext,
  });

  assert.equal(spec.recipe_path, '.goose/recipes/frontend-implementation.yaml');
  assert.equal(spec.output_schema_path, '.goose/recipes/shared/worker-output-schema.json');
  assert.equal(spec.inputs.repo_path, '/tmp/repo');
  assert.equal(spec.inputs.task.task_id, task.task_id);
  assert.deepEqual(spec.inputs.task.acceptance_criteria, task.acceptance_criteria);
  assert.equal(spec.inputs.retry_context, null);
  assert.deepEqual(spec.inputs.attempt_history, []);
  assert.equal(spec.inputs.failure_category, 'verification_incomplete');
  assert.equal(
    spec.inputs.failure_diagnosis,
    'The previous continuation skipped required verification commands.',
  );
  assert.deepEqual(spec.inputs.reconsider_instructions, [
    'Run the missing verification commands before another handoff.',
  ]);
  assert.equal(spec.inputs.repeated_pattern_summary, null);
  assert.deepEqual(spec.inputs.runtime_context, runtimeContext);
  assert.ok(spec.inputs.runtime_context.task_context_files.every((item) => !isMachineSpecificPath(item)));
});

test('buildGooseRecipeExecution maps backend-agent to backend recipe and passes retry context', () => {
  const task = buildTask('backend-agent');
  task.failure_category = 'quality_needs_fix';
  task.failure_diagnosis = 'The last retry replayed the same review fix without broader coverage.';
  task.reconsider_instructions = [
    'Read the review thread before editing the same file again.',
    'Add broader fixture coverage before the next handoff.',
  ];
  task.repeated_pattern_summary =
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.';
  task.attempt_history = [
    {
      attempt: 1,
      status: 'needs_fix',
      summary: 'Address review feedback on validation flow.',
      changed_files: ['src/orchestrator/main-orchestrator.ts'],
      blocker_category: null,
      blocker_message: null,
      failure_category: 'quality_needs_fix',
      failure_diagnosis: 'The first pass missed broader fixture coverage.',
      reconsider_instructions: ['Add broader fixture coverage before the next handoff.'],
      repeated_pattern_summary: null,
      checklist_feedback: ['Missing verification evidence for required command: npm run test:runtime'],
      implementation_evidence: ['Updated retry routing.'],
      test_evidence: ['node --test tests/orchestrator-runtime.test.mjs'],
      review_feedback: ['Please tighten null-handling around retry state.'],
      commands_run: ['npm run build'],
      test_results: [{ name: 'tests/orchestrator-runtime.test.mjs', status: 'pass' }],
      risk_notes: ['Potential hidden edge-cases in nested dependencies.'],
      suggested_status: 'implementation_done',
      delivery_metadata: null,
    },
  ];
  const runtimeContext = {
    repo_context_summary: [
      'Goose integration baseline includes structured worker-result contracts and external quality gates.',
    ],
    environment_snapshot: {
      package_manager: 'npm',
      package_manifest_path: 'package.json',
      lockfile_path: 'package-lock.json',
      build_command: 'npm run build',
      test_commands: ['npm run test:adapter', 'npm run test:runtime'],
    },
    task_context_files: ['docs/context/repo-context.md', 'README.md', 'src/adapters/goose-recipe-builder.ts'],
    verification_plan: {
      commands: ['npm run build', 'npm run test:runtime'],
      environment_checks: ['git status --short'],
      definition_of_done: ['Backend worker uses injected verification commands before returning.'],
      reconsider_signals: ['Backend goose recipe dropped reconsideration guidance.'],
      retry_handoff: {
        attempt: 2,
        status: 'needs_fix',
        summary: 'Address review feedback on validation flow.',
        blocker_category: null,
        blocker_message: null,
        failure_category: 'quality_needs_fix',
        failure_diagnosis: 'The last retry replayed the same review fix without broader coverage.',
        reconsider_instructions: [
          'Read the review thread before editing the same file again.',
          'Add broader fixture coverage before the next handoff.',
        ],
        repeated_pattern_summary:
          'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
        checklist_feedback: ['Missing verification evidence for required command: npm run test:runtime'],
        commands_run: ['npm run build'],
        review_feedback: ['Please tighten null-handling around retry state.'],
      },
    },
    time_budget_hint: 'Attempt 3 of 3; 0 retries remain after this pass.',
  };

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
      failure_category: 'quality_needs_fix',
      failure_diagnosis: 'The last retry replayed the same review fix without broader coverage.',
      reconsider_instructions: [
        'Read the review thread before editing the same file again.',
        'Add broader fixture coverage before the next handoff.',
      ],
      repeated_pattern_summary:
        'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
      checklist_feedback: ['Missing verification evidence for required command: npm run test:runtime'],
      implementation_evidence: ['Updated retry routing.'],
      test_evidence: ['node --test tests/orchestrator-runtime.test.mjs'],
      review_feedback: ['Please tighten null-handling around retry state.'],
      commands_run: ['npm run build'],
      test_results: [{ name: 'tests/orchestrator-runtime.test.mjs', status: 'pass' }],
      risk_notes: ['Potential hidden edge-cases in nested dependencies.'],
      suggested_status: 'implementation_done',
      delivery_metadata: null,
    },
    runtimeContext,
  });

  assert.equal(spec.recipe_path, '.goose/recipes/backend-implementation.yaml');
  assert.equal(spec.inputs.retry_context?.attempt, 2);
  assert.equal(spec.inputs.attempt_history.length, 1);
  assert.equal(spec.inputs.failure_category, 'quality_needs_fix');
  assert.equal(
    spec.inputs.failure_diagnosis,
    'The last retry replayed the same review fix without broader coverage.',
  );
  assert.deepEqual(spec.inputs.reconsider_instructions, [
    'Read the review thread before editing the same file again.',
    'Add broader fixture coverage before the next handoff.',
  ]);
  assert.equal(
    spec.inputs.repeated_pattern_summary,
    'Attempts 1 and 2 repeated the same review blocker on unchanged files.',
  );
  assert.deepEqual(spec.inputs.retry_context?.review_feedback, [
    'Please tighten null-handling around retry state.',
  ]);
  assert.deepEqual(spec.inputs.task.acceptance_criteria, task.acceptance_criteria);
  assert.deepEqual(spec.inputs.runtime_context?.verification_plan.commands, [
    'npm run build',
    'npm run test:runtime',
  ]);
  assert.deepEqual(spec.inputs.runtime_context?.verification_plan.reconsider_signals, [
    'Backend goose recipe dropped reconsideration guidance.',
  ]);
  assert.deepEqual(spec.inputs.runtime_context?.verification_plan.retry_handoff?.checklist_feedback, [
    'Missing verification evidence for required command: npm run test:runtime',
  ]);
  assert.equal(
    spec.inputs.runtime_context?.verification_plan.retry_handoff?.failure_diagnosis,
    'The last retry replayed the same review fix without broader coverage.',
  );
  assert.deepEqual(spec.inputs.runtime_context?.task_context_files, [
    'docs/context/repo-context.md',
    'README.md',
    'src/adapters/goose-recipe-builder.ts',
  ]);
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

test('execute-next-plan-task declares linked design and task doc inputs for plan-linked docs flows', () => {
  const recipe = fs.readFileSync('.goose/recipes/execute-next-plan-task.yaml', 'utf8');

  assert.match(recipe, /- key: design_doc_path\b/);
  assert.match(recipe, /- key: task_doc_paths_json\b/);
  assert.match(recipe, /linked design doc path/i);
  assert.match(recipe, /linked task docs json/i);
  assert.match(recipe, /each task-sized PR must include at least one docs update/i);
});

test('execute-next-plan-task refreshes checked-in context before merge', () => {
  const recipe = fs.readFileSync('.goose/recipes/execute-next-plan-task.yaml', 'utf8');
  const refreshIndex = recipe.indexOf('refresh the repository context artifacts on the task branch');
  const mergeIndex = recipe.indexOf('Do not merge the PR in this recipe');

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

test('implementation recipes declare and reference runtime_context so goose-backed runs can see injected guidance', () => {
  for (const recipePath of [
    '.goose/recipes/frontend-implementation.yaml',
    '.goose/recipes/backend-implementation.yaml',
  ]) {
    const recipe = fs.readFileSync(recipePath, 'utf8');

    assert.match(recipe, /- key: runtime_context\b/);
    assert.match(recipe, /Runtime context JSON:\s*\n\s*\{\{ runtime_context \}\}/);
    assert.match(recipe, /start with the injected runtime context/i);
    assert.match(recipe, /plan-linked design\/task docs/i);
  }
});

test('implementation recipes declare retry diagnosis inputs so goose-backed retries can change approach', () => {
  for (const recipePath of [
    '.goose/recipes/frontend-implementation.yaml',
    '.goose/recipes/backend-implementation.yaml',
  ]) {
    const recipe = fs.readFileSync(recipePath, 'utf8');

    assert.match(recipe, /- key: attempt_history\b/);
    assert.match(recipe, /- key: failure_category\b/);
    assert.match(recipe, /- key: failure_diagnosis\b/);
    assert.match(recipe, /- key: reconsider_instructions\b/);
    assert.match(recipe, /- key: repeated_pattern_summary\b/);
    assert.match(recipe, /Attempt history JSON:\s*\n\s*\{\{ attempt_history \}\}/);
    assert.match(recipe, /Failure diagnosis:\s*\n\s*\{\{ failure_diagnosis \}\}/);
    assert.match(recipe, /Reconsideration instructions JSON:\s*\n\s*\{\{ reconsider_instructions \}\}/);
  }
});

test('implementation protocols treat missing verification evidence as unfinished work', () => {
  const frontendPrompt = fs.readFileSync('prompts/frontend-agent.md', 'utf8');
  const backendPrompt = fs.readFileSync('prompts/backend-agent.md', 'utf8');
  const taskContract = fs.readFileSync('docs/goose/task-contract.md', 'utf8');

  for (const content of [frontendPrompt, backendPrompt, taskContract]) {
    assert.match(content, /verification .* part of task completion/i);
    assert.match(content, /missing verification .* unfinished work/i);
    assert.match(content, /explicit verification evidence/i);
  }

  for (const recipePath of [
    '.goose/recipes/frontend-implementation.yaml',
    '.goose/recipes/backend-implementation.yaml',
  ]) {
    const recipe = fs.readFileSync(recipePath, 'utf8');

    assert.match(recipe, /missing verification .* unfinished work/i);
    assert.match(recipe, /explicit verification evidence/i);
  }
});
