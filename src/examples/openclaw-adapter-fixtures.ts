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

  return createOpenClawWorkerRoleRequest({
    task: runtime.tasks['task-api-contract'],
    runtime,
    repoPath: '/tmp/openclaw-adapter-fixture-repo',
    prompt: {
      prompt_id: 'backend-agent',
      prompt_path: 'prompts/backend-agent.md',
    },
  });
}
