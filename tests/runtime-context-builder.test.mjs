import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DefaultPlanningNormalizer,
  buildDirectPlanningFixtureRequest,
  buildExecutionDag,
  buildExecutionGuidancePlanningDraft,
  buildRuntimeContextPackage,
  createWorkerRetryHandoff,
  discoverLocalExecutionHints,
} from '../dist/index.js';

function buildExecutionGuidanceTask() {
  const normalizer = new DefaultPlanningNormalizer();
  const planningResult = normalizer.normalize({
    request: buildDirectPlanningFixtureRequest(),
    resolved_mode: 'direct',
    draft: buildExecutionGuidancePlanningDraft(),
    planner_routes: [
      {
        role: 'planning-agent',
        selected_model: 'codex',
        attempted_models: ['codex'],
      },
    ],
  });

  const { runtime } = buildExecutionDag(planningResult, {
    runId: 'run-runtime-context-builder',
    availableModels: ['openai-codex/gpt-5.4'],
  });

  return runtime.tasks['task-plan-contract'];
}

test('local execution discovery returns conservative empty values when repo hints are absent', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-context-empty-'));

  const discovery = discoverLocalExecutionHints(repoPath);

  assert.equal(discovery.package_manager, 'unknown');
  assert.equal(discovery.package_manifest_path, null);
  assert.equal(discovery.lockfile_path, null);
  assert.equal(discovery.build_command, null);
  assert.deepEqual(discovery.test_commands, []);
});

test('runtime context builder assembles compact worker-facing context from repo state and retry handoff', () => {
  const repoPath = process.cwd();
  const task = buildExecutionGuidanceTask();

  task.retry_count = 1;
  task.max_retries = 2;
  task.prior_attempt = createWorkerRetryHandoff(
    {
      changed_files: ['src/schemas/planning.ts'],
      commands_run: ['npm run build', 'node --test tests/planning-pipeline.test.mjs'],
      review_feedback: ['Carry execution guidance into runtime without dropping compactness.'],
      risk_notes: ['Do not dump the full repo context artifact into worker payloads.'],
      blocker_category: 'quality',
      blocker_message: 'Runtime task lost execution guidance during handoff.',
    },
    1,
    'needs_fix',
    'Quality feedback requested another implementation pass.',
  );

  const discovery = discoverLocalExecutionHints(repoPath);
  const runtimeContext = buildRuntimeContextPackage({
    repoPath,
    task,
  });

  assert.deepEqual(runtimeContext.environment_snapshot, discovery);
  assert.deepEqual(runtimeContext.task_context_files, [
    'docs/context/repo-context.md',
    'README.md',
    'src/schemas/planning.ts',
  ]);
  assert.deepEqual(runtimeContext.verification_plan.commands, [
    'npm run build',
    'node --test tests/planning-pipeline.test.mjs',
  ]);
  assert.deepEqual(runtimeContext.verification_plan.definition_of_done, [
    'Execution guidance is preserved on the normalized planning task.',
    'Execution guidance is present on the runtime task after DAG conversion.',
  ]);
  assert.equal(
    runtimeContext.verification_plan.retry_handoff?.summary,
    'Quality feedback requested another implementation pass.',
  );
  assert.deepEqual(runtimeContext.verification_plan.retry_handoff?.review_feedback, [
    'Carry execution guidance into runtime without dropping compactness.',
  ]);
  assert.match(runtimeContext.time_budget_hint, /Attempt 2 of 3/);

  assert.ok(runtimeContext.repo_context_summary.some((item) =>
    item.includes('main-orchestrator is sole global controller')));
  assert.ok(runtimeContext.repo_context_summary.some((item) =>
    item.includes('planning outputs implementation tasks only')));
  assert.ok(runtimeContext.repo_context_summary.length <= 8);
  assert.ok(runtimeContext.repo_context_summary.every((item) => !item.includes('##')));
  assert.ok(runtimeContext.repo_context_summary.every((item) => !item.includes('```')));
});
