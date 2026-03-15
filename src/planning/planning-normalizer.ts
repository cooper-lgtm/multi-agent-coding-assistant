import type { PlanningNormalizationInput, PlanningNormalizer } from './contracts.js';
import type {
  PlanningResult,
  PlanningTask,
  PlannerRouteTrace,
  QualityGate,
} from '../schemas/planning.js';

function compactStrings(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;

  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeQualityGate(taskId: string, qualityGate: QualityGate): QualityGate {
  const gateReason = qualityGate.gate_reason.trim();
  if (!gateReason) {
    throw new Error(`Task ${taskId} must include a non-empty quality_gate.gate_reason`);
  }

  return {
    test_required: Boolean(qualityGate.test_required),
    review_required: Boolean(qualityGate.review_required),
    gate_reason: gateReason,
  };
}

function normalizeTask(task: PlanningTask): PlanningTask {
  const id = task.id.trim();
  if (!id) throw new Error('Planning tasks must include a non-empty id');

  const title = task.title.trim();
  const description = task.description.trim();
  if (!title) throw new Error(`Task ${id} must include a non-empty title`);
  if (!description) throw new Error(`Task ${id} must include a non-empty description`);

  return {
    ...task,
    id,
    title,
    description,
    suggested_model: task.suggested_model?.trim() || undefined,
    depends_on: [...new Set(task.depends_on.map((dependency) => dependency.trim()).filter(Boolean))],
    acceptance_criteria: [
      ...new Set(task.acceptance_criteria.map((criterion) => criterion.trim()).filter(Boolean)),
    ],
    quality_gate: normalizeQualityGate(id, task.quality_gate),
    parallel_group: task.parallel_group?.trim() || undefined,
  };
}

function buildParallelGroups(tasks: PlanningTask[], explicitGroups?: Record<string, string[]>): Record<string, string[]> | undefined {
  const groups = new Map<string, string[]>();

  for (const [groupName, taskIds] of Object.entries(explicitGroups ?? {})) {
    groups.set(groupName, [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))]);
  }

  for (const task of tasks) {
    if (!task.parallel_group) continue;
    const existing = groups.get(task.parallel_group) ?? [];
    if (!existing.includes(task.id)) existing.push(task.id);
    groups.set(task.parallel_group, existing);
  }

  if (groups.size === 0) return undefined;

  return Object.fromEntries(
    [...groups.entries()].map(([groupName, taskIds]) => [groupName, taskIds]),
  );
}

function sortTasksTopologically(tasks: PlanningTask[]): PlanningTask[] {
  const ordered: PlanningTask[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  function visit(taskId: string): void {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      throw new Error(`Cycle detected during planning normalization at task ${taskId}`);
    }

    visiting.add(taskId);
    const task = taskMap.get(taskId);
    if (!task) return;

    for (const dependencyId of task.depends_on) {
      if (taskMap.has(dependencyId)) visit(dependencyId);
    }

    visiting.delete(taskId);
    visited.add(taskId);
    ordered.push(task);
  }

  for (const task of tasks) visit(task.id);
  return ordered;
}

function buildPlannerTraceRoutes(routes: PlannerRouteTrace[]): PlannerRouteTrace[] {
  return routes.map((route) => ({
    role: route.role,
    selected_model: route.selected_model,
    attempted_models: [...route.attempted_models],
  }));
}

export class DefaultPlanningNormalizer implements PlanningNormalizer {
  normalize(input: PlanningNormalizationInput): PlanningResult {
    const tasks = sortTasksTopologically(input.draft.tasks.map(normalizeTask));
    const notes_for_orchestrator = compactStrings(input.draft.notes_for_orchestrator);
    const risks = compactStrings(input.draft.risks);

    return {
      schema_version: '1.0.0',
      planning_mode: input.resolved_mode,
      epic: input.draft.epic.trim(),
      recommended_plan: input.draft.recommended_plan.trim(),
      tasks,
      parallel_groups: buildParallelGroups(tasks, input.draft.parallel_groups),
      notes_for_orchestrator,
      risks,
      planning_trace: {
        requested_mode: input.request.planning_mode,
        resolved_mode: input.resolved_mode,
        planner_routes: buildPlannerTraceRoutes(input.planner_routes),
        debate: input.debate?.map((analysis) => ({
          role: analysis.role,
          summary: analysis.summary.trim(),
          recommended_plan: analysis.recommended_plan.trim(),
        })),
      },
    };
  }
}
