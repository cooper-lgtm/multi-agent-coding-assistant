import type {
  AssignedAgent,
  PlanningMode,
  PlanningResult,
  QualityGate,
  QualityStatus,
  ReviewStatus,
  RiskLevel,
  RuntimeTaskStatus,
  Complexity,
} from './planning.js';

export interface EscalationPolicy {
  on_first_failure: 'retry_same_model';
  on_second_failure: 'upgrade_model';
  on_third_failure: 'manual_orchestrator_decision';
}

export interface ExecutionNode {
  task_id: string;
  title: string;
  description: string;
  assigned_agent: AssignedAgent;
  model: string;
  complexity: Complexity;
  risk: RiskLevel;
  depends_on: string[];
  acceptance_criteria: string[];
  quality_gate: QualityGate;
  status: RuntimeTaskStatus;
  test_status: QualityStatus;
  review_status: ReviewStatus;
  retry_count: number;
  max_retries: number;
  escalation_policy: EscalationPolicy;
  result: string | null;
  error: string | null;
}

export interface ExecutionGraph {
  epic: string;
  planning_mode: PlanningMode;
  source_planning_result: PlanningResult;
  nodes: Record<string, ExecutionNode>;
  edges: Array<{ from: string; to: string }>;
  parallel_groups: Record<string, string[]>;
}

export interface RuntimeEvent {
  timestamp: string;
  task_id?: string;
  type: string;
  message: string;
}

export interface RuntimeState {
  run_id: string;
  epic: string;
  graph: ExecutionGraph;
  tasks: Record<string, ExecutionNode>;
  events: RuntimeEvent[];
}

export interface DagBuildResult {
  graph: ExecutionGraph;
  runtime: RuntimeState;
  ready_tasks: ExecutionNode[];
}

export interface RunSummaryCounts {
  completed: number;
  needs_fix: number;
  blocked: number;
  failed: number;
  pending: number;
}

export interface TaskRunSummary {
  task_id: string;
  title: string;
  status: RuntimeTaskStatus;
  assigned_agent: AssignedAgent;
  model: string;
  retry_count: number;
  test_status: QualityStatus;
  review_status: ReviewStatus;
}

export type RunFinalStatus = 'completed' | 'needs_fix' | 'blocked' | 'failed' | 'running';

export interface RunSummary {
  run_id: string;
  epic: string;
  final_status: RunFinalStatus;
  counts: RunSummaryCounts;
  tasks: TaskRunSummary[];
  events: string[];
}

export interface OrchestrationRunResult extends DagBuildResult {
  summary: RunSummary;
}
