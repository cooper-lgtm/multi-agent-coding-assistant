import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DefaultPlanningNormalizer,
  PlanningController,
  buildDirectPlanningFixtureRequest,
  buildDebatePlanningFixtureRequest,
  buildExecutionGuidancePlanningDraft,
  buildExecutionDag,
  validatePlanningResult,
} from '../dist/index.js';

test('planning pipeline produces a validated direct planning result and DAG', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan(buildDirectPlanningFixtureRequest());
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'direct');
  assert.equal(planningResult.tasks.length, 2);
  assert.ok(planningResult.tasks.every((task) =>
    task.assigned_agent === 'frontend-agent' || task.assigned_agent === 'backend-agent'));
  assert.ok(planningResult.tasks.every((task) =>
    task.assigned_agent !== 'test-agent' && task.assigned_agent !== 'review-agent'));
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.role),
    ['planning-agent'],
  );

  const dag = buildExecutionDag(planningResult);
  assert.equal(Object.keys(dag.graph.nodes).length, planningResult.tasks.length);
  assert.deepEqual(
    dag.graph.edges,
    [{ from: 'task-plan-contract', to: 'task-plan-ui' }],
  );
});

test('planning pipeline produces a synthesized debate planning result and DAG', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan(buildDebatePlanningFixtureRequest());
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'debate');
  assert.equal(planningResult.tasks.length, 3);
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.role),
    ['architecture-planner', 'engineering-planner', 'integration-planner'],
  );
  assert.equal(planningResult.planning_trace?.debate?.length, 3);
  assert.ok(planningResult.recommended_plan.includes('contract'));
  assert.ok(planningResult.recommended_plan.includes('integration'));

  const dag = buildExecutionDag(planningResult);
  assert.deepEqual(dag.graph.edges, [
    { from: 'task-plan-contract', to: 'task-plan-ui' },
    { from: 'task-plan-contract', to: 'task-plan-integration' },
    { from: 'task-plan-ui', to: 'task-plan-integration' },
  ]);
});

test('planning pipeline resolves auto to debate and preserves trace metadata', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan({
    ...buildDebatePlanningFixtureRequest(),
    planning_mode: 'auto',
  });
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'auto_resolved_debate');
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.selected_model),
    ['claude', 'codex', 'gemini'],
  );
  assert.ok(
    planningResult.notes_for_orchestrator?.includes(
      'Synthesized from architecture-planner, engineering-planner, and integration-planner.',
    ),
  );
});

test('planning normalization rejects duplicate task ids before validation can collapse them', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  await assert.rejects(
    controller.createPlan({
      ...buildDirectPlanningFixtureRequest(),
      existing_artifacts: ['fixture:duplicate-task-id'],
    }),
    /Duplicate task id detected during planning normalization: task-plan-contract/,
  );
});

test('planning normalization preserves execution guidance through validation and DAG conversion', () => {
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

  validatePlanningResult(planningResult);

  assert.deepEqual(planningResult.tasks[0].execution_guidance, {
    must_read_files: ['README.md', 'src/schemas/planning.ts'],
    verification_commands: ['npm run build', 'node --test tests/planning-pipeline.test.mjs'],
    environment_checks: ['node -v', 'git status --short'],
    definition_of_done: [
      'Execution guidance is preserved on the normalized planning task.',
      'Execution guidance is present on the runtime task after DAG conversion.',
    ],
    reconsider_signals: [
      'Execution guidance is missing from the runtime task.',
      'Required verification commands are dropped during normalization.',
    ],
  });

  const dag = buildExecutionDag(planningResult);
  assert.deepEqual(dag.graph.nodes['task-plan-contract'].execution_guidance, planningResult.tasks[0].execution_guidance);
  assert.deepEqual(dag.runtime.tasks['task-plan-contract'].execution_guidance, planningResult.tasks[0].execution_guidance);
});
