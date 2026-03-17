import { ModelRouter } from '../adapters/model-router.js';
import {
  DEFAULT_OPENCLAW_AVAILABLE_MODELS,
  OpenClawModelResolver,
} from '../adapters/openclaw-model-resolver.js';
import {
  createOpenClawPlanningRoleRequest,
  createOpenClawWorkerRoleRequest,
} from '../adapters/openclaw-runtime-adapter.js';
import { buildExecutionDag } from '../orchestrator/dag-builder.js';
import {
  buildDemoPlanningFixture,
  buildDirectPlanningFixtureRequest,
} from './planning-fixtures.js';

export function buildOpenClawAvailableModelsFixture(): string[] {
  return [...DEFAULT_OPENCLAW_AVAILABLE_MODELS];
}

export function buildOpenClawPlanningRoleRequestFixture() {
  const availableModels = buildOpenClawAvailableModelsFixture();
  const router = new ModelRouter();
  const resolver = new OpenClawModelResolver();
  const route = router.route('planning-agent', { availableModels });

  return createOpenClawPlanningRoleRequest({
    role: 'planning-agent',
    request: buildDirectPlanningFixtureRequest(),
    resolvedMode: 'direct',
    model: route.selectedModelMetadata ?? resolver.resolve(route.selectedModel),
    prompt: {
      prompt_id: 'planning-agent.system',
      prompt_path: 'prompts/planning-agent.system.md',
    },
  });
}

export function buildOpenClawWorkerRoleRequestFixture() {
  const availableModels = buildOpenClawAvailableModelsFixture();
  const { runtime } = buildExecutionDag(buildDemoPlanningFixture(), {
    runId: 'run-openclaw-adapter-fixture',
    availableModels,
  });
  const task = runtime.tasks['task-api-contract'];

  task.retry_count = 1;
  task.changed_files = ['src/api/contract.ts'];
  task.blocker_category = 'quality';
  task.blocker_message = 'Previous review requested one naming cleanup before approval.';
  task.implementation_evidence = ['Locked the API contract for downstream UI consumers.'];
  task.test_evidence = ['Previous adapter smoke test passed before review feedback arrived.'];
  task.review_feedback = ['Review requested one naming cleanup before approval.'];
  task.commands_run = ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'];
  task.test_results = [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }];
  task.risk_notes = ['Broaden adapter smoke coverage after the naming cleanup lands.'];
  task.suggested_status = 'needs_fix';
  task.delivery_metadata = {
    branch_name: 'feat/openclaw-adapter-fixture',
    commit_sha: 'abc1234',
  };
  task.prior_attempt = {
    attempt: 1,
    status: 'needs_fix',
    summary: 'Review requested one naming cleanup before approval.',
    changed_files: ['src/api/contract.ts'],
    blocker_category: 'quality',
    blocker_message: 'Previous review requested one naming cleanup before approval.',
    implementation_evidence: ['Locked the API contract for downstream UI consumers.'],
    test_evidence: ['Previous adapter smoke test passed before review feedback arrived.'],
    review_feedback: ['Review requested one naming cleanup before approval.'],
    commands_run: ['npm run build', 'node --test tests/openclaw-runtime-adapter.test.mjs'],
    test_results: [{ name: 'tests/openclaw-runtime-adapter.test.mjs', status: 'pass' }],
    risk_notes: ['Broaden adapter smoke coverage after the naming cleanup lands.'],
    suggested_status: 'needs_fix',
    delivery_metadata: {
      branch_name: 'feat/openclaw-adapter-fixture',
      commit_sha: 'abc1234',
    },
  };

  return createOpenClawWorkerRoleRequest({
    task,
    runtime,
    repoPath: '/tmp/openclaw-adapter-fixture-repo',
    prompt: {
      prompt_id: 'backend-agent',
      prompt_path: 'prompts/backend-agent.md',
    },
  });
}
