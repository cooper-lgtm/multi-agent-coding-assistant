import { ModelRouter } from '../adapters/model-router.js';
import type { PlanningRequest, PlanningResult } from '../schemas/planning.js';

export interface PlanningControllerOptions {
  availableModels?: string[];
}

export class PlanningController {
  private readonly router = new ModelRouter();

  constructor(private readonly options: PlanningControllerOptions = {}) {}

  resolvePlanningMode(request: PlanningRequest): PlanningResult['planning_mode'] {
    if (request.planning_mode === 'direct') return 'direct';
    if (request.planning_mode === 'debate') return 'debate';

    const complexSignals = [
      request.request,
      request.project_summary,
      ...request.constraints,
      ...request.relevant_context,
    ].join(' ').toLowerCase();

    const shouldDebate =
      complexSignals.includes('frontend') ||
      complexSignals.includes('backend') ||
      complexSignals.includes('cross') ||
      complexSignals.includes('integration') ||
      complexSignals.includes('complex');

    return shouldDebate ? 'auto_resolved_debate' : 'auto_resolved_direct';
  }

  selectPlannerModels() {
    const availableModels = this.options.availableModels ?? ['gpt-5.4', 'codex', 'gemini', 'claude'];
    return {
      planningAgent: this.router.route('planning-agent', { availableModels }),
      architecturePlanner: this.router.route('architecture-planner', { availableModels }),
      engineeringPlanner: this.router.route('engineering-planner', { availableModels }),
      integrationPlanner: this.router.route('integration-planner', { availableModels }),
    };
  }
}
