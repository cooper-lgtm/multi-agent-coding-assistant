import type {
  ClarifiedPlanningBrief,
  DebatePlannerRoleName,
  PlannerCrossReviewFinding,
  PlannerRouteTrace,
  PlanningClarificationRequest,
  PlanningRequest,
  PlanningResult,
  PlanningTask,
  ResolvedPlanningMode,
} from '../schemas/planning.js';

export interface PlanningDraft {
  epic: string;
  recommended_plan: string;
  tasks: PlanningTask[];
  parallel_groups?: Record<string, string[]>;
  notes_for_orchestrator?: string[];
  risks?: string[];
}

export interface PlanningPipelineContext {
  request: PlanningRequest;
  resolved_mode: ResolvedPlanningMode;
  available_models: string[];
  clarified_brief?: ClarifiedPlanningBrief;
}

export interface DirectPlanningInput extends PlanningPipelineContext {
  planner_route: PlannerRouteTrace;
}

export interface DebateAnalyzerInput extends PlanningPipelineContext {
  role: DebatePlannerRoleName;
  planner_route: PlannerRouteTrace;
}

export interface DebateAnalysis extends PlanningDraft {
  role: DebatePlannerRoleName;
  summary: string;
  planner_route: PlannerRouteTrace;
  clarification_requests?: PlanningClarificationRequest[];
  cross_review_findings?: PlannerCrossReviewFinding[];
}

export interface DebateSynthesisInput extends PlanningPipelineContext {
  analyses: DebateAnalysis[];
}

export interface PlanningNormalizationInput {
  request: PlanningRequest;
  resolved_mode: ResolvedPlanningMode;
  draft: PlanningDraft;
  planner_routes: PlannerRouteTrace[];
  clarified_brief?: ClarifiedPlanningBrief;
  clarification_rounds?: number;
  cross_review_rounds?: number;
  debate?: DebateAnalysis[];
}

export interface PlanningModeResolver {
  resolve(request: PlanningRequest): ResolvedPlanningMode;
}

export interface DirectPlanner {
  plan(input: DirectPlanningInput): Promise<PlanningDraft>;
}

export interface DebateAnalyzer {
  analyze(input: DebateAnalyzerInput): Promise<DebateAnalysis>;
}

export interface DebateSynthesizer {
  synthesize(input: DebateSynthesisInput): Promise<PlanningDraft>;
}

export interface PlanningNormalizer {
  normalize(input: PlanningNormalizationInput): PlanningResult;
}
