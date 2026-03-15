import { ModelRouter, type RoleName } from '../adapters/model-router.js';
import type { DagBuildResult, ExecutionGraph, ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import type { PlanningResult } from '../schemas/planning.js';
import { validatePlanningResult } from './planning-validator.js';

export interface DagBuilderOptions {
  runId?: string;
  availableModels?: string[];
  maxRetriesPerTask?: number;
}

export function buildExecutionDag(
  planningResult: PlanningResult,
  options: DagBuilderOptions = {},
): DagBuildResult {
  validatePlanningResult(planningResult);

  const router = new ModelRouter();
  const availableModels = options.availableModels ?? ['gpt-5.4', 'codex', 'gemini', 'claude'];
  const maxRetries = options.maxRetriesPerTask ?? 2;

  const nodes: Record<string, ExecutionNode> = {};
  const edges: Array<{ from: string; to: string }> = [];

  for (const task of planningResult.tasks) {
    const role: RoleName = task.assigned_agent;
    const selectedModel = task.suggested_model && availableModels.includes(task.suggested_model)
      ? task.suggested_model
      : router.route(role, { availableModels }).selectedModel;

    nodes[task.id] = {
      task_id: task.id,
      title: task.title,
      description: task.description,
      assigned_agent: task.assigned_agent,
      model: selectedModel,
      complexity: task.complexity,
      risk: task.risk,
      depends_on: [...task.depends_on],
      acceptance_criteria: [...task.acceptance_criteria],
      quality_gate: task.quality_gate,
      status: 'pending',
      test_status: 'pending',
      review_status: 'pending',
      retry_count: 0,
      max_retries: maxRetries,
      escalation_policy: {
        on_first_failure: 'retry_same_model',
        on_second_failure: 'upgrade_model',
        on_third_failure: 'manual_orchestrator_decision',
      },
      result: null,
      error: null,
    };

    for (const dependency of task.depends_on) {
      edges.push({ from: dependency, to: task.id });
    }
  }

  const graph: ExecutionGraph = {
    epic: planningResult.epic,
    planning_mode: planningResult.planning_mode,
    source_planning_result: planningResult,
    nodes,
    edges,
    parallel_groups: planningResult.parallel_groups ?? {},
  };

  const runtime: RuntimeState = {
    run_id: options.runId ?? `run-${Date.now()}`,
    epic: planningResult.epic,
    graph,
    tasks: structuredClone(nodes),
    events: [
      {
        timestamp: new Date().toISOString(),
        type: 'runtime_initialized',
        message: `Runtime initialized for epic ${planningResult.epic}`,
      },
    ],
  };

  return {
    graph,
    runtime,
    ready_tasks: findReadyTasks(runtime),
  };
}

export function findReadyTasks(runtime: RuntimeState): ExecutionNode[] {
  return Object.values(runtime.tasks).filter((task) => {
    if (task.status !== 'pending') return false;
    return task.depends_on.every((dependencyId) => runtime.tasks[dependencyId]?.status === 'completed');
  });
}
