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
export type PlannerCrossReviewDisposition =
  | 'agree'
  | 'disagree'
  | 'missing_risk'
  | 'missing_dependency'
  | 'ownership_concern';

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
export type RoleFallbackPolicy = Partial<Record<AssignedAgent, string[]>>;

export interface BudgetPolicy {
  maxParallelTasks?: number;
  allowDebatePlanning?: boolean;
  maxRetriesPerTask?: number;
  taskRetryBudgets?: Record<string, number>;
  riskEscalationThreshold?: RiskLevel;
  roleFallbackPolicy?: RoleFallbackPolicy;
}

export type ExecutionControlMode = 'auto-execute' | 'confirm-before-run';

export interface ExecutionControl {
  mode: ExecutionControlMode;
}

export interface QualityGate {
  test_required: boolean;
  review_required: boolean;
  gate_reason: string;
}

export interface ExecutionGuidance {
  must_read_files: string[];
  verification_commands: string[];
  environment_checks: string[];
  definition_of_done: string[];
  reconsider_signals: string[];
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
  execution_guidance?: ExecutionGuidance;
  parallel_group?: string;
}

export interface PlannerRouteTrace {
  role: PlanningRoleName;
  selected_model: string;
  attempted_models: string[];
  selected_model_metadata?: ModelResolution;
}

export interface ClarifiedPlanningBrief {
  version: number;
  request_summary: string;
  goals: string[];
  non_goals: string[];
  constraints: string[];
  assumptions: string[];
  known_risks: string[];
  unresolved_questions: string[];
  ready_for_planning: boolean;
}

export interface PlanningClarificationRequest {
  requester: DebatePlannerRoleName;
  question: string;
  rationale: string;
  blocking: boolean;
}

export interface PlannerCrossReviewFinding {
  reviewer: DebatePlannerRoleName;
  target: DebatePlannerRoleName;
  disposition: PlannerCrossReviewDisposition;
  evidence: string;
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
  clarified_brief?: ClarifiedPlanningBrief;
  clarification_rounds?: number;
  cross_review_rounds?: number;
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
  execution_control?: ExecutionControl;
  existing_artifacts?: string[];
}
