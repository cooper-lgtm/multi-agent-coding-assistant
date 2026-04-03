import type { PlanningNormalizationInput, PlanningNormalizer } from './contracts.js';
import type {
  ClarifiedPlanningBrief,
  ExecutionGuidance,
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

function compactRequiredStrings(taskId: string, fieldName: string, values: string[]): string[] {
  const normalized = compactStrings(values);
  if (!normalized) {
    throw new Error(`Task ${taskId} must include at least one execution_guidance.${fieldName} entry`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(fieldName: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer when provided`);
  }

  return value;
}

function normalizeBoundedProtocolRoundCount(
  fieldName: string,
  value: number | undefined,
): number | undefined {
  const normalized = normalizeNonNegativeInteger(fieldName, value);
  if (normalized === undefined) {
    return undefined;
  }

  if (normalized > 1) {
    throw new Error(`${fieldName} must be 0 or 1 when provided`);
  }

  return normalized;
}

function normalizeRequiredBoolean(fieldName: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function normalizeOptionalStringList(fieldName: string, value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array when provided`);
  }

  return [...new Set(value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${fieldName} must include non-empty string entries`);
    }

    return entry.trim();
  }))];
}

function normalizeClarifiedPlanningBrief(
  clarifiedBrief: ClarifiedPlanningBrief | undefined,
): ClarifiedPlanningBrief | undefined {
  if (!clarifiedBrief) return undefined;

  if (typeof clarifiedBrief.request_summary !== 'string') {
    throw new Error('planning_trace.clarified_brief.request_summary must be a string');
  }

  const requestSummary = clarifiedBrief.request_summary.trim();
  if (!requestSummary) {
    throw new Error('planning_trace.clarified_brief.request_summary must be non-empty');
  }

  const version = normalizeNonNegativeInteger(
    'planning_trace.clarified_brief.version',
    clarifiedBrief.version,
  );
  if (version === undefined) {
    throw new Error('planning_trace.clarified_brief.version must be provided');
  }

  return {
    version,
    request_summary: requestSummary,
    goals: normalizeOptionalStringList('planning_trace.clarified_brief.goals', clarifiedBrief.goals),
    non_goals: normalizeOptionalStringList('planning_trace.clarified_brief.non_goals', clarifiedBrief.non_goals),
    constraints: normalizeOptionalStringList('planning_trace.clarified_brief.constraints', clarifiedBrief.constraints),
    assumptions: normalizeOptionalStringList('planning_trace.clarified_brief.assumptions', clarifiedBrief.assumptions),
    known_risks: normalizeOptionalStringList('planning_trace.clarified_brief.known_risks', clarifiedBrief.known_risks),
    unresolved_questions: normalizeOptionalStringList(
      'planning_trace.clarified_brief.unresolved_questions',
      clarifiedBrief.unresolved_questions,
    ),
    ready_for_planning: normalizeRequiredBoolean(
      'planning_trace.clarified_brief.ready_for_planning',
      clarifiedBrief.ready_for_planning,
    ),
  };
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

function normalizeExecutionGuidance(
  taskId: string,
  executionGuidance: ExecutionGuidance | undefined,
): ExecutionGuidance | undefined {
  if (!executionGuidance) return undefined;

  return {
    must_read_files: compactRequiredStrings(
      taskId,
      'must_read_files',
      executionGuidance.must_read_files,
    ),
    verification_commands: compactRequiredStrings(
      taskId,
      'verification_commands',
      executionGuidance.verification_commands,
    ),
    environment_checks: compactRequiredStrings(
      taskId,
      'environment_checks',
      executionGuidance.environment_checks,
    ),
    definition_of_done: compactRequiredStrings(
      taskId,
      'definition_of_done',
      executionGuidance.definition_of_done,
    ),
    reconsider_signals: compactRequiredStrings(
      taskId,
      'reconsider_signals',
      executionGuidance.reconsider_signals,
    ),
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
    execution_guidance: normalizeExecutionGuidance(id, task.execution_guidance),
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
  const taskMap = new Map<string, PlanningTask>();

  for (const task of tasks) {
    if (taskMap.has(task.id)) {
      throw new Error(`Duplicate task id detected during planning normalization: ${task.id}`);
    }
    taskMap.set(task.id, task);
  }

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
    selected_model_metadata: route.selected_model_metadata,
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
        clarified_brief: normalizeClarifiedPlanningBrief(input.clarified_brief),
        clarification_rounds: normalizeBoundedProtocolRoundCount(
          'planning_trace.clarification_rounds',
          input.clarification_rounds,
        ),
        cross_review_rounds: normalizeBoundedProtocolRoundCount(
          'planning_trace.cross_review_rounds',
          input.cross_review_rounds,
        ),
        debate: input.debate?.map((analysis) => ({
          role: analysis.role,
          summary: analysis.summary.trim(),
          recommended_plan: analysis.recommended_plan.trim(),
        })),
      },
    };
  }
}
