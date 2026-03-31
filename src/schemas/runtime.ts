import type { ModelResolution } from './models.js';
import type {
  AssignedAgent,
  ExecutionControlMode,
  ExecutionGuidance,
  PlanningMode,
  PlanningResult,
  QualityGate,
  QualityStatus,
  ReviewStatus,
  RoleFallbackPolicy,
  RiskLevel,
  RuntimeTaskStatus,
  Complexity,
} from './planning.js';
import type {
  WorkerBlockerCategory,
  WorkerDeliveryMetadata,
  WorkerFailureCategory,
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
  execution_guidance?: ExecutionGuidance;
  status: RuntimeTaskStatus;
  test_status: QualityStatus;
  review_status: ReviewStatus;
  retry_count: number;
  max_retries: number;
  fallback_models: string[];
  escalation_policy: EscalationPolicy;
  changed_files: string[];
  blocker_category: WorkerBlockerCategory | null;
  blocker_message: string | null;
  failure_category: WorkerFailureCategory | null;
  failure_diagnosis: string | null;
  reconsider_instructions: string[];
  repeated_pattern_summary: string | null;
  checklist_feedback: string[];
  implementation_evidence: string[];
  test_evidence: string[];
  review_feedback: string[];
  commands_run: string[];
  test_results: WorkerTestResult[];
  risk_notes: string[];
  suggested_status: WorkerSuggestedStatus | null;
  delivery_metadata: WorkerDeliveryMetadata | null;
  prior_attempt: WorkerRetryHandoff | null;
  attempt_history: WorkerRetryHandoff[];
  result: string | null;
  error: string | null;
}

export interface RuntimePolicyState {
  max_parallel_tasks: number | null;
  max_retries_per_task: number;
  task_retry_budgets: Record<string, number>;
  risk_escalation_threshold: RiskLevel | null;
  role_fallback_policy: RoleFallbackPolicy;
}

export interface ExecutionGraph {
  epic: string;
  planning_mode: PlanningMode;
  source_planning_result: PlanningResult;
  nodes: Record<string, ExecutionNode>;
  edges: Array<{ from: string; to: string }>;
  parallel_groups: Record<string, string[]>;
}

export type RuntimeEventPhase =
  | 'orchestration'
  | 'implementation'
  | 'quality_gate'
  | 'retry'
  | 'control';

export type RuntimeEventFailureCategory =
  | WorkerBlockerCategory
  | 'implementation_failed'
  | 'implementation_blocked'
  | 'quality_failed'
  | 'quality_needs_fix'
  | 'verification_incomplete'
  | 'policy';

export type RuntimeEventMetadataValue = string | number | boolean | null | Array<string | number | boolean>;
export type RuntimeEventMetadata = Record<string, RuntimeEventMetadataValue>;

export interface RuntimeEventModelSelection {
  selected_model: string;
  logical_model: string | null;
  exact_model_id: string | null;
  provider: string | null;
}

export interface RuntimeEvent {
  timestamp: string;
  task_id?: string;
  type: string;
  message: string;
  phase: RuntimeEventPhase;
  attempt: number | null;
  task_status: RuntimeTaskStatus | null;
  failure_category: RuntimeEventFailureCategory | null;
  model: RuntimeEventModelSelection | null;
  metadata: RuntimeEventMetadata;
}

export interface CreateRuntimeEventInput {
  timestamp?: string;
  task_id?: string;
  type: string;
  message: string;
  phase?: RuntimeEventPhase;
  attempt?: number | null;
  task_status?: RuntimeTaskStatus | null;
  failure_category?: RuntimeEventFailureCategory | null;
  model?: RuntimeEventModelSelection | null;
  metadata?: RuntimeEventMetadata | null;
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

export type ApprovalStatus = 'auto_approved' | 'waiting_for_approval' | 'approved';

export interface RuntimeApprovalState {
  mode: ExecutionControlMode;
  status: ApprovalStatus;
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
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
  approval_state: RuntimeApprovalState | null;
  policy_state: RuntimePolicyState | null;
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
  failure_category: WorkerFailureCategory | null;
  failure_diagnosis: string | null;
  reconsider_instructions: string[];
  repeated_pattern_summary: string | null;
  checklist_feedback: string[];
  implementation_evidence: string[];
  test_evidence: string[];
  review_feedback: string[];
  commands_run: string[];
  test_results: WorkerTestResult[];
  risk_notes: string[];
  suggested_status: WorkerSuggestedStatus | null;
  delivery_metadata: WorkerDeliveryMetadata | null;
  prior_attempt: WorkerRetryHandoff | null;
  attempt_history: WorkerRetryHandoff[];
}

export type RunFinalStatus = RunLifecycleStatus;

export interface RunSummary {
  run_id: string;
  epic: string;
  final_status: RunFinalStatus;
  approval_state: RuntimeApprovalState | null;
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
  approval_state: RuntimeApprovalState | null;
  artifacts: RunManifestArtifacts;
}

export const RUNTIME_STORAGE_VERSION = '1';

const RUNTIME_TASK_STATUSES = new Set<RuntimeTaskStatus>([
  'pending',
  'routed',
  'running',
  'implementation_done',
  'testing',
  'reviewing',
  'completed',
  'needs_fix',
  'blocked',
  'failed',
  'cancelled',
]);

const RUNTIME_EVENT_PHASES = new Set<RuntimeEventPhase>([
  'orchestration',
  'implementation',
  'quality_gate',
  'retry',
  'control',
]);

const RUNTIME_EVENT_FAILURE_CATEGORIES = new Set<RuntimeEventFailureCategory>([
  'requirements',
  'repository',
  'dependency',
  'environment',
  'quality',
  'unknown',
  'implementation_failed',
  'implementation_blocked',
  'quality_failed',
  'quality_needs_fix',
  'verification_incomplete',
  'policy',
]);

const IMPLEMENTATION_EVENT_TYPES = new Set([
  'task_routed',
  'implementation_completed',
]);

const QUALITY_GATE_EVENT_TYPES = new Set([
  'quality_gate_started',
  'test_gate_routed',
  'review_gate_routed',
  'task_completed',
]);

const RETRY_EVENT_TYPES = new Set([
  'retry_scheduled',
  'task_terminal_negative',
  'task_blocked_by_dependency',
  'task_blocked_by_policy',
]);

const CONTROL_EVENT_TYPES = new Set([
  'awaiting_human_approval',
  'pause_requested',
  'run_paused',
  'cancel_requested',
  'run_cancelled',
]);

export function createRuntimeEvent(input: CreateRuntimeEventInput): RuntimeEvent {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...(input.task_id ? { task_id: input.task_id } : {}),
    type: input.type,
    message: input.message,
    phase: input.phase ?? inferRuntimeEventPhase(input.type),
    attempt: normalizeRuntimeEventAttempt(input.attempt),
    task_status: isRuntimeTaskStatus(input.task_status) ? input.task_status : null,
    failure_category: isRuntimeEventFailureCategory(input.failure_category) ? input.failure_category : null,
    model: normalizeRuntimeEventModel(input.model),
    metadata: normalizeRuntimeEventMetadata(input.metadata),
  };
}

export function normalizeRuntimeEvent(event: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'type' | 'message'>): RuntimeEvent {
  return createRuntimeEvent({
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString(),
    task_id: typeof event.task_id === 'string' ? event.task_id : undefined,
    type: event.type,
    message: event.message,
    phase: isRuntimeEventPhase(event.phase) ? event.phase : inferRuntimeEventPhase(event.type),
    attempt: normalizeRuntimeEventAttempt(event.attempt),
    task_status: isRuntimeTaskStatus(event.task_status) ? event.task_status : null,
    failure_category: isRuntimeEventFailureCategory(event.failure_category) ? event.failure_category : null,
    model: normalizeRuntimeEventModel(event.model),
    metadata: normalizeRuntimeEventMetadata(event.metadata),
  });
}

export function normalizeRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.map((event) => normalizeRuntimeEvent(event));
}

export function inferRuntimeEventPhase(type: string): RuntimeEventPhase {
  if (IMPLEMENTATION_EVENT_TYPES.has(type)) {
    return 'implementation';
  }

  if (QUALITY_GATE_EVENT_TYPES.has(type)) {
    return 'quality_gate';
  }

  if (RETRY_EVENT_TYPES.has(type)) {
    return 'retry';
  }

  if (CONTROL_EVENT_TYPES.has(type)) {
    return 'control';
  }

  return 'orchestration';
}

export function createRuntimeEventModelSelection(
  selectedModel: string,
  modelMetadata?: ModelResolution | null,
): RuntimeEventModelSelection {
  return {
    selected_model: selectedModel,
    logical_model: modelMetadata?.logical_model ?? selectedModel ?? null,
    exact_model_id: modelMetadata?.exact_model_id ?? null,
    provider: modelMetadata?.provider ?? null,
  };
}

function isRuntimeTaskStatus(value: unknown): value is RuntimeTaskStatus {
  return typeof value === 'string' && RUNTIME_TASK_STATUSES.has(value as RuntimeTaskStatus);
}

function isRuntimeEventPhase(value: unknown): value is RuntimeEventPhase {
  return typeof value === 'string' && RUNTIME_EVENT_PHASES.has(value as RuntimeEventPhase);
}

function isRuntimeEventFailureCategory(value: unknown): value is RuntimeEventFailureCategory {
  return typeof value === 'string' && RUNTIME_EVENT_FAILURE_CATEGORIES.has(value as RuntimeEventFailureCategory);
}

function normalizeRuntimeEventAttempt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function normalizeRuntimeEventModel(value: unknown): RuntimeEventModelSelection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RuntimeEventModelSelection>;
  if (typeof candidate.selected_model !== 'string' || candidate.selected_model.length === 0) {
    return null;
  }

  return {
    selected_model: candidate.selected_model,
    logical_model: typeof candidate.logical_model === 'string' ? candidate.logical_model : null,
    exact_model_id: typeof candidate.exact_model_id === 'string' ? candidate.exact_model_id : null,
    provider: typeof candidate.provider === 'string' ? candidate.provider : null,
  };
}

function normalizeRuntimeEventMetadata(value: unknown): RuntimeEventMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const metadata: RuntimeEventMetadata = {};

  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeRuntimeEventMetadataValue(raw);
    if (normalized !== undefined) {
      metadata[key] = normalized;
    }
  }

  return metadata;
}

function normalizeRuntimeEventMetadataValue(value: unknown): RuntimeEventMetadataValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
    return [...value];
  }

  return undefined;
}

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
