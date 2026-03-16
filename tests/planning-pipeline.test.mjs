import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PlanningController,
  buildDirectPlanningFixtureRequest,
  buildDebatePlanningFixtureRequest,
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
