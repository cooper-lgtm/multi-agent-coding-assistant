import type { PlanningResult } from '../schemas/planning.js';

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
    if (!task.quality_gate) throw new Error(`Missing quality_gate for task ${task.id}`);
    if (!task.acceptance_criteria?.length) {
      throw new Error(`Task ${task.id} must include acceptance_criteria`);
    }
  }

  for (const task of planningResult.tasks) {
    for (const dependency of task.depends_on) {
      if (!ids.has(dependency)) {
        throw new Error(`Task ${task.id} depends on unknown task ${dependency}`);
      }
    }
  }

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
