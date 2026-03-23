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

test('local execution discovery preserves script commands when package.json exists without a lockfile', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-context-scripts-'));

  fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
    name: 'no-lockfile-repo',
    scripts: {
      build: 'tsc -p tsconfig.json',
      test: 'node --test',
      'test:runtime': 'node --test tests/runtime-context-builder.test.mjs',
    },
  }, null, 2));

  const discovery = discoverLocalExecutionHints(repoPath);

  assert.equal(discovery.package_manager, 'unknown');
  assert.equal(discovery.lockfile_path, null);
  assert.equal(discovery.build_command, 'npm run build');
  assert.deepEqual(discovery.test_commands, [
    'npm run test',
    'npm run test:runtime',
  ]);
});

test('local execution discovery prefers manifest packageManager over lockfile probe order', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-context-manager-'));

  fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
    name: 'mixed-lockfiles-repo',
    packageManager: 'pnpm@9.0.0',
    scripts: {
      build: 'tsc -p tsconfig.json',
      test: 'node --test',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(repoPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');

  const discovery = discoverLocalExecutionHints(repoPath);

  assert.equal(discovery.package_manager, 'pnpm');
  assert.equal(discovery.lockfile_path, 'pnpm-lock.yaml');
  assert.equal(discovery.build_command, 'pnpm run build');
  assert.deepEqual(discovery.test_commands, ['pnpm run test']);
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
