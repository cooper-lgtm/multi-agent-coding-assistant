import type { ModelResolution } from './models.js';

export type RequestedPlanningMode = 'auto' | 'direct' | 'debate';
export type ResolvedPlanningMode = 'direct' | 'debate' | 'auto_resolved_direct' | 'auto_resolved_debate';
export type PlanningMode = RequestedPlanningMode | ResolvedPlanningMode;
export type PlanningRoleName =
  | 'planning-agent'
  | 'architecture-planner'
  | 'engineering-planner'
  | 'integration-planner';
export type DebatePlannerRoleName =
  | 'architecture-planner'
  | 'engineering-planner'
  | 'integration-planner';

export type AssignedAgent = 'frontend-agent' | 'backend-agent';
export type QualityStatus = 'pending' | 'pass' | 'fail' | 'skipped';
export type ReviewStatus = 'pending' | 'approved' | 'needs_fix' | 'skipped';
export type RuntimeTaskStatus =
  | 'pending'
  | 'routed'
  | 'running'
  | 'implementation_done'
  | 'testing'
  | 'reviewing'
  | 'completed'
  | 'needs_fix'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type Complexity = 'low' | 'medium' | 'high';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface BudgetPolicy {
  maxParallelTasks?: number;
  allowDebatePlanning?: boolean;
  maxRetriesPerTask?: number;
}

export interface QualityGate {
  test_required: boolean;
  review_required: boolean;
  gate_reason: string;
}

export interface PlanningTask {
  id: string;
  title: string;
  description: string;
  assigned_agent: AssignedAgent;
  suggested_model?: string;
  complexity: Complexity;
  risk: RiskLevel;
  depends_on: string[];
  acceptance_criteria: string[];
  quality_gate: QualityGate;
  parallel_group?: string;
}

export interface PlannerRouteTrace {
  role: PlanningRoleName;
  selected_model: string;
  attempted_models: string[];
  selected_model_metadata?: ModelResolution;
}

export interface DebateTraceEntry {
  role: DebatePlannerRoleName;
  summary: string;
  recommended_plan: string;
}

export interface PlanningTrace {
  requested_mode: RequestedPlanningMode;
  resolved_mode: ResolvedPlanningMode;
  planner_routes: PlannerRouteTrace[];
  debate?: DebateTraceEntry[];
}

export interface PlanningResult {
  schema_version: string;
  planning_mode: ResolvedPlanningMode;
  epic: string;
  recommended_plan: string;
  tasks: PlanningTask[];
  parallel_groups?: Record<string, string[]>;
  notes_for_orchestrator?: string[];
  risks?: string[];
  planning_trace?: PlanningTrace;
}

export interface PlanningRequest {
  request: string;
  project_summary: string;
  relevant_context: string[];
  planning_mode: RequestedPlanningMode;
  constraints: string[];
  budget_policy?: BudgetPolicy;
  existing_artifacts?: string[];
}
