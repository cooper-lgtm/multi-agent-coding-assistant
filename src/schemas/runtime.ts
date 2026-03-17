import type { ModelResolution } from './models.js';
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
import type {
  WorkerBlockerCategory,
  WorkerDeliveryMetadata,
  WorkerRetryHandoff,
  WorkerSuggestedStatus,
  WorkerTestResult,
} from '../workers/contracts.js';

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
  model_metadata?: ModelResolution;
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
  changed_files: string[];
  blocker_category: WorkerBlockerCategory | null;
  blocker_message: string | null;
  implementation_evidence: string[];
  test_evidence: string[];
  review_feedback: string[];
  commands_run: string[];
  test_results: WorkerTestResult[];
  risk_notes: string[];
  suggested_status: WorkerSuggestedStatus | null;
  delivery_metadata: WorkerDeliveryMetadata | null;
  prior_attempt: WorkerRetryHandoff | null;
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

export type RunLifecycleStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'needs_fix'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface RuntimeControlState {
  pause_requested: boolean;
  cancel_requested: boolean;
}

export interface RuntimeState {
  run_id: string;
  epic: string;
  graph: ExecutionGraph;
  tasks: Record<string, ExecutionNode>;
  events: RuntimeEvent[];
  status: RunLifecycleStatus;
  created_at: string;
  updated_at: string;
  storage_version: string;
  control: RuntimeControlState;
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
  cancelled: number;
  pending: number;
}

export interface TaskRunSummary {
  task_id: string;
  title: string;
  status: RuntimeTaskStatus;
  assigned_agent: AssignedAgent;
  model: string;
  model_metadata?: ModelResolution;
  retry_count: number;
  test_status: QualityStatus;
  review_status: ReviewStatus;
  changed_files: string[];
  blocker_category: WorkerBlockerCategory | null;
  blocker_message: string | null;
  implementation_evidence: string[];
  test_evidence: string[];
  review_feedback: string[];
  commands_run: string[];
  test_results: WorkerTestResult[];
  risk_notes: string[];
  suggested_status: WorkerSuggestedStatus | null;
  delivery_metadata: WorkerDeliveryMetadata | null;
  prior_attempt: WorkerRetryHandoff | null;
}

export type RunFinalStatus = RunLifecycleStatus;

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

export interface RunManifestArtifacts {
  runtime_snapshot: string;
  event_log: string;
}

export interface RunTaskCounts {
  total: number;
  pending: number;
  routed: number;
  running: number;
  implementation_done: number;
  testing: number;
  reviewing: number;
  completed: number;
  needs_fix: number;
  blocked: number;
  failed: number;
  cancelled: number;
}

export interface RunManifest {
  schema_version: string;
  run_id: string;
  epic: string;
  planning_mode: PlanningMode;
  status: RunLifecycleStatus;
  created_at: string;
  updated_at: string;
  last_persisted_at: string;
  task_counts: RunTaskCounts;
  control: RuntimeControlState;
  artifacts: RunManifestArtifacts;
}

export const RUNTIME_STORAGE_VERSION = '1';

export function countTaskStatuses(tasks: Record<string, ExecutionNode>): RunTaskCounts {
  const counts: RunTaskCounts = {
    total: 0,
    pending: 0,
    routed: 0,
    running: 0,
    implementation_done: 0,
    testing: 0,
    reviewing: 0,
    completed: 0,
    needs_fix: 0,
    blocked: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const task of Object.values(tasks)) {
    counts.total += 1;

    switch (task.status) {
      case 'pending':
        counts.pending += 1;
        break;
      case 'routed':
        counts.routed += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      case 'implementation_done':
        counts.implementation_done += 1;
        break;
      case 'testing':
        counts.testing += 1;
        break;
      case 'reviewing':
        counts.reviewing += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'needs_fix':
        counts.needs_fix += 1;
        break;
      case 'blocked':
        counts.blocked += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
    }
  }

  return counts;
}
