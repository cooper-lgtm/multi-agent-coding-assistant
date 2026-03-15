import type { Complexity, PlanningTask, QualityGate, RiskLevel } from '../schemas/planning.js';
import type { DebateAnalysis, DebateSynthesizer, PlanningDraft, DebateSynthesisInput } from './contracts.js';

const COMPLEXITY_RANK: Record<Complexity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const RISK_RANK: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pickHigherComplexity(left: Complexity, right: Complexity): Complexity {
  return COMPLEXITY_RANK[left] >= COMPLEXITY_RANK[right] ? left : right;
}

function pickHigherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

function mergeQualityGate(left: QualityGate, right: QualityGate): QualityGate {
  return {
    test_required: left.test_required || right.test_required,
    review_required: left.review_required || right.review_required,
    gate_reason: uniqueStrings([left.gate_reason, right.gate_reason]).join(' '),
  };
}

function cloneTask(task: PlanningTask): PlanningTask {
  return {
    ...task,
    depends_on: [...task.depends_on],
    acceptance_criteria: [...task.acceptance_criteria],
    quality_gate: {
      ...task.quality_gate,
    },
  };
}

function mergeTask(existing: PlanningTask, incoming: PlanningTask): PlanningTask {
  if (existing.assigned_agent !== incoming.assigned_agent) {
    throw new Error(
      `Debate synthesis found conflicting owners for task ${existing.id}: ${existing.assigned_agent} vs ${incoming.assigned_agent}`,
    );
  }

  return {
    ...existing,
    title: existing.title.length >= incoming.title.length ? existing.title : incoming.title,
    description:
      existing.description.length >= incoming.description.length
        ? existing.description
        : incoming.description,
    suggested_model: existing.suggested_model ?? incoming.suggested_model,
    complexity: pickHigherComplexity(existing.complexity, incoming.complexity),
    risk: pickHigherRisk(existing.risk, incoming.risk),
    depends_on: uniqueStrings([...existing.depends_on, ...incoming.depends_on]),
    acceptance_criteria: uniqueStrings([
      ...existing.acceptance_criteria,
      ...incoming.acceptance_criteria,
    ]),
    quality_gate: mergeQualityGate(existing.quality_gate, incoming.quality_gate),
    parallel_group: existing.parallel_group ?? incoming.parallel_group,
  };
}

function buildRecommendedPlan(analyses: DebateAnalysis[]): string {
  return analyses
    .map((analysis) => analysis.recommended_plan.trim())
    .filter(Boolean)
    .join(' ');
}

export class DefaultDebateSynthesizer implements DebateSynthesizer {
  async synthesize(input: DebateSynthesisInput): Promise<PlanningDraft> {
    if (input.analyses.length === 0) {
      throw new Error('Debate synthesis requires at least one analysis.');
    }

    const mergedTasks = new Map<string, PlanningTask>();
    for (const analysis of input.analyses) {
      for (const task of analysis.tasks) {
        const current = mergedTasks.get(task.id);
        mergedTasks.set(task.id, current ? mergeTask(current, task) : cloneTask(task));
      }
    }

    return {
      epic: input.analyses[0].epic,
      recommended_plan: buildRecommendedPlan(input.analyses),
      tasks: [...mergedTasks.values()],
      notes_for_orchestrator: uniqueStrings([
        ...input.analyses.flatMap((analysis) => analysis.notes_for_orchestrator ?? []),
        'Synthesized from architecture-planner, engineering-planner, and integration-planner.',
      ]),
      risks: uniqueStrings(input.analyses.flatMap((analysis) => analysis.risks ?? [])),
    };
  }
}
