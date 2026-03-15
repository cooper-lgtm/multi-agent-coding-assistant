import {
  DEFAULT_OPENCLAW_AVAILABLE_MODELS,
} from '../adapters/openclaw-model-resolver.js';
import { ModelRouter, type ModelRouteDecision } from '../adapters/model-router.js';
import type { DebatePlannerRoleName, PlannerRouteTrace, PlanningRequest, ResolvedPlanningMode } from '../schemas/planning.js';
import { validatePlanningResult } from '../orchestrator/planning-validator.js';
import type {
  DebateAnalysis,
  DebateAnalyzer,
  DebateSynthesizer,
  DirectPlanner,
  PlanningModeResolver,
  PlanningNormalizer,
} from './contracts.js';
import { DefaultDebateSynthesizer } from './debate-synthesizer.js';
import { MockDebateAnalyzer, MockDirectPlanner } from './mock-planners.js';
import { DefaultPlanningModeResolver } from './planning-mode-resolver.js';
import { DefaultPlanningNormalizer } from './planning-normalizer.js';

export interface PlanningPipelineDependencies {
  modeResolver: PlanningModeResolver;
  directPlanner: DirectPlanner;
  analyzers: Record<DebatePlannerRoleName, DebateAnalyzer>;
  synthesizer: DebateSynthesizer;
  normalizer: PlanningNormalizer;
  validatePlanningResult(result: Parameters<typeof validatePlanningResult>[0]): void;
}

export interface PlanningPipelineOptions {
  availableModels?: string[];
  router?: ModelRouter;
  dependencies?: Partial<PlanningPipelineDependencies>;
}

function toPlannerRoute(route: ModelRouteDecision): PlannerRouteTrace {
  return {
    role: route.role as PlannerRouteTrace['role'],
    selected_model: route.selectedModel,
    attempted_models: [...route.attemptedModels],
    selected_model_metadata: route.selectedModelMetadata,
  };
}

export class PlanningPipeline {
  private readonly router: ModelRouter;
  private readonly dependencies: PlanningPipelineDependencies;

  constructor(private readonly options: PlanningPipelineOptions = {}) {
    this.router = options.router ?? new ModelRouter();
    this.dependencies = {
      modeResolver: options.dependencies?.modeResolver ?? new DefaultPlanningModeResolver(),
      directPlanner: options.dependencies?.directPlanner ?? new MockDirectPlanner(),
      analyzers: options.dependencies?.analyzers ?? {
        'architecture-planner': new MockDebateAnalyzer('architecture-planner'),
        'engineering-planner': new MockDebateAnalyzer('engineering-planner'),
        'integration-planner': new MockDebateAnalyzer('integration-planner'),
      },
      synthesizer: options.dependencies?.synthesizer ?? new DefaultDebateSynthesizer(),
      normalizer: options.dependencies?.normalizer ?? new DefaultPlanningNormalizer(),
      validatePlanningResult:
        options.dependencies?.validatePlanningResult ?? validatePlanningResult,
    };
  }

  resolvePlanningMode(request: PlanningRequest): ResolvedPlanningMode {
    return this.dependencies.modeResolver.resolve(request);
  }

  selectPlannerModels() {
    const availableModels = this.options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
    return {
      planningAgent: this.router.route('planning-agent', { availableModels }),
      architecturePlanner: this.router.route('architecture-planner', { availableModels }),
      engineeringPlanner: this.router.route('engineering-planner', { availableModels }),
      integrationPlanner: this.router.route('integration-planner', { availableModels }),
    };
  }

  async createPlan(request: PlanningRequest) {
    const availableModels = this.options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
    const resolvedMode = this.resolvePlanningMode(request);

    if (resolvedMode === 'direct' || resolvedMode === 'auto_resolved_direct') {
      const plannerRoute = toPlannerRoute(
        this.router.route('planning-agent', { availableModels }),
      );
      const draft = await this.dependencies.directPlanner.plan({
        request,
        resolved_mode: resolvedMode,
        available_models: availableModels,
        planner_route: plannerRoute,
      });

      const result = this.dependencies.normalizer.normalize({
        request,
        resolved_mode: resolvedMode,
        draft,
        planner_routes: [plannerRoute],
      });
      this.dependencies.validatePlanningResult(result);
      return result;
    }

    const roles: DebatePlannerRoleName[] = [
      'architecture-planner',
      'engineering-planner',
      'integration-planner',
    ];

    const analyses = await Promise.all(
      roles.map(async (role): Promise<DebateAnalysis> => {
        const plannerRoute = toPlannerRoute(this.router.route(role, { availableModels }));
        return this.dependencies.analyzers[role].analyze({
          request,
          resolved_mode: resolvedMode,
          available_models: availableModels,
          role,
          planner_route: plannerRoute,
        });
      }),
    );

    const draft = await this.dependencies.synthesizer.synthesize({
      request,
      resolved_mode: resolvedMode,
      available_models: availableModels,
      analyses,
    });

    const result = this.dependencies.normalizer.normalize({
      request,
      resolved_mode: resolvedMode,
      draft,
      planner_routes: analyses.map((analysis) => analysis.planner_route),
      debate: analyses,
    });
    this.dependencies.validatePlanningResult(result);
    return result;
  }
}
