import type { PlanningRequest, ResolvedPlanningMode } from '../schemas/planning.js';
import { PlanningPipeline, type PlanningPipelineOptions } from './planning-pipeline.js';

export interface PlanningControllerOptions extends PlanningPipelineOptions {}

export class PlanningController {
  private readonly pipeline: PlanningPipeline;

  constructor(private readonly options: PlanningControllerOptions = {}) {
    this.pipeline = new PlanningPipeline(options);
  }

  resolvePlanningMode(request: PlanningRequest): ResolvedPlanningMode {
    return this.pipeline.resolvePlanningMode(request);
  }

  selectPlannerModels() {
    return this.pipeline.selectPlannerModels();
  }

  async createPlan(request: PlanningRequest) {
    return this.pipeline.createPlan(request);
  }
}
