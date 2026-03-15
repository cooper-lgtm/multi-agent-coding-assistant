import { DEFAULT_OPENCLAW_AVAILABLE_MODELS } from '../adapters/openclaw-model-resolver.js';
import { buildExecutionDag } from '../orchestrator/dag-builder.js';
import { PlanningController } from '../planning/planning-controller.js';
import {
  buildDebatePlanningFixtureRequest,
  buildDirectPlanningFixtureRequest,
} from './planning-fixtures.js';

const controller = new PlanningController({
  availableModels: DEFAULT_OPENCLAW_AVAILABLE_MODELS,
});

function printScenario(label: string, request = buildDirectPlanningFixtureRequest()) {
  return controller.createPlan(request).then((planningResult) => {
    const dag = buildExecutionDag(planningResult);

    console.log(`\n[${label}] ${planningResult.epic}`);
    console.log(`Resolved mode: ${planningResult.planning_mode}`);
    console.log(
      `Planner routes: ${planningResult.planning_trace?.planner_routes
        .map((route) =>
          `${route.role}:${route.selected_model}${
            route.selected_model_metadata ? `->${route.selected_model_metadata.exact_model_id}` : ''
          }`,
        )
        .join(', ')}`,
    );
    for (const task of planningResult.tasks) {
      console.log(
        `- ${task.id}: ${task.assigned_agent} deps=[${task.depends_on.join(', ') || 'none'}]`,
      );
    }
    console.log(
      `DAG edges: ${dag.graph.edges.map((edge) => `${edge.from}->${edge.to}`).join(', ') || 'none'}`,
    );
  });
}

await printScenario('direct', buildDirectPlanningFixtureRequest());
await printScenario('debate', buildDebatePlanningFixtureRequest());
