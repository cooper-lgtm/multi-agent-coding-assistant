import type { PlanningResult } from '../schemas/planning.js';

function validateExecutionGuidance(taskId: string, guidance: PlanningResult['tasks'][number]['execution_guidance']): void {
  if (!guidance) return;

  const requiredFields: Array<keyof NonNullable<typeof guidance>> = [
    'must_read_files',
    'verification_commands',
    'environment_checks',
    'definition_of_done',
    'reconsider_signals',
  ];

  for (const field of requiredFields) {
    const values = guidance[field];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Task ${taskId} must include execution_guidance.${field}`);
    }

    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Task ${taskId} must include non-empty execution_guidance.${field} entries`);
      }
    }
  }
}

function validateOptionalStringList(fieldName: string, values: string[] | undefined): void {
  if (values === undefined) {
    return;
  }

  if (!Array.isArray(values)) {
    throw new Error(`${fieldName} must be an array when provided`);
  }

  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${fieldName} must include non-empty string entries`);
    }
  }
}

function validateOptionalBoundedRoundCount(fieldName: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be 0 or 1 when provided`);
  }
}

function validatePlanningTrace(planningTrace: PlanningResult['planning_trace']): void {
  if (!planningTrace) {
    return;
  }

  if (!Array.isArray(planningTrace.planner_routes) || planningTrace.planner_routes.length === 0) {
    throw new Error('planning_trace.planner_routes must include at least one route');
  }

  if (planningTrace.clarified_brief) {
    if (
      !Number.isInteger(planningTrace.clarified_brief.version)
      || planningTrace.clarified_brief.version < 0
    ) {
      throw new Error('planning_trace.clarified_brief.version must be a non-negative integer');
    }
    if (typeof planningTrace.clarified_brief.request_summary !== 'string') {
      throw new Error('planning_trace.clarified_brief.request_summary must be a string');
    }
    if (!planningTrace.clarified_brief.request_summary.trim()) {
      throw new Error('planning_trace.clarified_brief.request_summary must be non-empty');
    }
    if (typeof planningTrace.clarified_brief.ready_for_planning !== 'boolean') {
      throw new Error('planning_trace.clarified_brief.ready_for_planning must be a boolean');
    }

    validateOptionalStringList('planning_trace.clarified_brief.goals', planningTrace.clarified_brief.goals);
    validateOptionalStringList('planning_trace.clarified_brief.non_goals', planningTrace.clarified_brief.non_goals);
    validateOptionalStringList('planning_trace.clarified_brief.constraints', planningTrace.clarified_brief.constraints);
    validateOptionalStringList('planning_trace.clarified_brief.assumptions', planningTrace.clarified_brief.assumptions);
    validateOptionalStringList('planning_trace.clarified_brief.known_risks', planningTrace.clarified_brief.known_risks);
    validateOptionalStringList(
      'planning_trace.clarified_brief.unresolved_questions',
      planningTrace.clarified_brief.unresolved_questions,
    );
  }

  validateOptionalBoundedRoundCount(
    'planning_trace.clarification_rounds',
    planningTrace.clarification_rounds,
  );
  validateOptionalBoundedRoundCount(
    'planning_trace.cross_review_rounds',
    planningTrace.cross_review_rounds,
  );
}

export function validatePlanningResult(planningResult: PlanningResult): void {
  if (!planningResult.schema_version) throw new Error('Missing schema_version');
  if (!planningResult.planning_mode) throw new Error('Missing planning_mode');
  if (!planningResult.epic) throw new Error('Missing epic');
  if (!planningResult.recommended_plan) throw new Error('Missing recommended_plan');
  if (!planningResult.tasks?.length) throw new Error('Planning result must include tasks');

  const ids = new Set<string>();
  for (const task of planningResult.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);

    if (!['frontend-agent', 'backend-agent'].includes(task.assigned_agent)) {
      throw new Error(`Invalid assigned_agent for task ${task.id}: ${task.assigned_agent}`);
    }
    if (!['low', 'medium', 'high'].includes(task.complexity)) {
      throw new Error(`Invalid complexity for task ${task.id}: ${task.complexity}`);
    }
    if (!['low', 'medium', 'high'].includes(task.risk)) {
      throw new Error(`Invalid risk for task ${task.id}: ${task.risk}`);
    }
    if (!Array.isArray(task.depends_on)) {
      throw new Error(`Task ${task.id} must include depends_on`);
    }
    if (!task.quality_gate) throw new Error(`Missing quality_gate for task ${task.id}`);
    if (typeof task.quality_gate.test_required !== 'boolean') {
      throw new Error(`Task ${task.id} must include a boolean quality_gate.test_required`);
    }
    if (typeof task.quality_gate.review_required !== 'boolean') {
      throw new Error(`Task ${task.id} must include a boolean quality_gate.review_required`);
    }
    if (!task.quality_gate.gate_reason?.trim()) {
      throw new Error(`Task ${task.id} must include quality_gate.gate_reason`);
    }
    if (!task.acceptance_criteria?.length) {
      throw new Error(`Task ${task.id} must include acceptance_criteria`);
    }
    validateExecutionGuidance(task.id, task.execution_guidance);
    if (task.depends_on.includes(task.id)) {
      throw new Error(`Task ${task.id} cannot depend on itself`);
    }
  }

  for (const task of planningResult.tasks) {
    for (const dependency of task.depends_on) {
      if (!ids.has(dependency)) {
        throw new Error(`Task ${task.id} depends on unknown task ${dependency}`);
      }
    }
  }

  for (const [groupName, taskIds] of Object.entries(planningResult.parallel_groups ?? {})) {
    for (const taskId of taskIds) {
      if (!ids.has(taskId)) {
        throw new Error(`Parallel group ${groupName} references unknown task ${taskId}`);
      }
    }
  }

  validatePlanningTrace(planningResult.planning_trace);
  detectCycles(planningResult);
}

function detectCycles(planningResult: PlanningResult): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const taskMap = new Map(planningResult.tasks.map((task) => [task.id, task]));

  function visit(taskId: string): void {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) throw new Error(`Cycle detected at task ${taskId}`);

    visiting.add(taskId);
    const task = taskMap.get(taskId);
    if (!task) throw new Error(`Unknown task during cycle detection: ${taskId}`);

    for (const dependency of task.depends_on) visit(dependency);

    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of planningResult.tasks) visit(task.id);
}
