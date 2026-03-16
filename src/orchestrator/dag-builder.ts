import {
  DEFAULT_OPENCLAW_AVAILABLE_MODELS,
  OpenClawModelResolver,
} from '../adapters/openclaw-model-resolver.js';
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
  const resolver = new OpenClawModelResolver();
  const availableModels = options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
  const maxRetries = options.maxRetriesPerTask ?? 2;

  const nodes: Record<string, ExecutionNode> = {};
  const edges: Array<{ from: string; to: string }> = [];

  for (const task of planningResult.tasks) {
    const role: RoleName = task.assigned_agent;
    const suggestedModelMetadata = task.suggested_model
      ? resolver.findAvailable(task.suggested_model, availableModels)
      : null;
    const routeDecision = suggestedModelMetadata ? null : router.route(role, { availableModels });
    const selectedModel = suggestedModelMetadata
      ? resolver.isExactModelId(task.suggested_model!)
        ? suggestedModelMetadata.logical_model
        : task.suggested_model!
      : routeDecision!.selectedModel;
    const modelMetadata = suggestedModelMetadata ?? routeDecision?.selectedModelMetadata;

    nodes[task.id] = {
      task_id: task.id,
      title: task.title,
      description: task.description,
      assigned_agent: task.assigned_agent,
      model: selectedModel,
      model_metadata: modelMetadata,
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
      changed_files: [],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: [],
      test_evidence: [],
      review_feedback: [],
      prior_attempt: null,
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
