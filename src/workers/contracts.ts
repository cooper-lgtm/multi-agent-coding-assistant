import type { AssignedAgent, QualityStatus, ReviewStatus } from '../schemas/planning.js';
import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';

export type WorkerBlockerCategory =
  | 'requirements'
  | 'repository'
  | 'dependency'
  | 'environment'
  | 'quality'
  | 'unknown';

export type WorkerAttemptStatus =
  | 'implementation_done'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'needs_fix';

export type WorkerSuggestedStatus = WorkerAttemptStatus;

export type WorkerTestStatus = 'pass' | 'fail' | 'skip' | 'pending';

export interface WorkerTestResult {
  name: string;
  status: WorkerTestStatus;
  details?: string;
}

export interface WorkerDeliveryMetadata {
  branch_name?: string | null;
  commit_sha?: string | null;
  pr_url?: string | null;
}

export type WorkerPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface WorkerEnvironmentSnapshot {
  package_manager: WorkerPackageManager;
  package_manifest_path: string | null;
  lockfile_path: string | null;
  build_command: string | null;
  test_commands: string[];
}

export interface WorkerRetryContextSummary {
  attempt: number;
  status: WorkerAttemptStatus;
  summary: string;
  blocker_category: WorkerBlockerCategory | null;
  blocker_message: string | null;
  commands_run: string[];
  review_feedback: string[];
}

export interface WorkerVerificationPlan {
  commands: string[];
  environment_checks: string[];
  definition_of_done: string[];
  reconsider_signals: string[];
  retry_handoff: WorkerRetryContextSummary | null;
}

export interface WorkerRuntimeContext {
  repo_context_summary: string[];
  environment_snapshot: WorkerEnvironmentSnapshot;
  task_context_files: string[];
  verification_plan: WorkerVerificationPlan;
  time_budget_hint: string | null;
}

export interface WorkerRetryHandoff {
  attempt: number;
  status: WorkerAttemptStatus;
  summary: string;
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
}

export interface WorkerExecutionContext {
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

export interface WorkerExecutionInput extends WorkerExecutionContext {
  task: ExecutionNode;
  runtime: RuntimeState;
  repo_path?: string;
  runtime_context: WorkerRuntimeContext | null;
}

export interface WorkerExecutionOutput extends WorkerExecutionContext {
  status: WorkerAttemptStatus;
  summary: string;
}

export interface CreateWorkerExecutionOutputInput {
  context?: Partial<WorkerExecutionContext> | Partial<ExecutionNode> | null;
  status: WorkerAttemptStatus;
  summary: string;
}

export interface ImplementationWorkerExecutionRequest extends WorkerExecutionInput {
  role: AssignedAgent;
}

export interface ImplementationWorkerExecutionResult extends WorkerExecutionOutput {
  role: AssignedAgent;
  status: 'implementation_done' | 'blocked' | 'failed';
}

export interface QualityGateWorkerExecutionRequest extends WorkerExecutionInput {
  roles: Array<'test-agent' | 'review-agent'>;
}

export interface QualityGateWorkerExecutionResult extends WorkerExecutionOutput {
  roles: Array<'test-agent' | 'review-agent'>;
  status: 'completed' | 'needs_fix' | 'failed';
  test_status: QualityStatus;
  review_status: ReviewStatus;
}

export function createWorkerExecutionContext(
  source: Partial<WorkerExecutionContext> | Partial<ExecutionNode> | null | undefined,
): WorkerExecutionContext {
  return {
    changed_files: [...(source?.changed_files ?? [])],
    blocker_category: source?.blocker_category ?? null,
    blocker_message: source?.blocker_message ?? null,
    implementation_evidence: [...(source?.implementation_evidence ?? [])],
    test_evidence: [...(source?.test_evidence ?? [])],
    review_feedback: [...(source?.review_feedback ?? [])],
    commands_run: [...(source?.commands_run ?? [])],
    test_results: (source?.test_results ?? []).map(cloneTestResult),
    risk_notes: [...(source?.risk_notes ?? [])],
    suggested_status: source?.suggested_status ?? null,
    delivery_metadata: source?.delivery_metadata ? cloneDeliveryMetadata(source.delivery_metadata) : null,
    prior_attempt: source?.prior_attempt ? cloneRetryHandoff(source.prior_attempt) : null,
  };
}

export function createWorkerExecutionOutput(input: CreateWorkerExecutionOutputInput): WorkerExecutionOutput {
  return {
    ...createWorkerExecutionContext(input.context),
    status: input.status,
    summary: input.summary,
  };
}

export function createImplementationWorkerExecutionRequest(input: {
  task: ExecutionNode;
  runtime: RuntimeState;
  repoPath?: string;
  runtimeContext?: WorkerRuntimeContext | null;
}): ImplementationWorkerExecutionRequest {
  return {
    role: input.task.assigned_agent,
    task: input.task,
    runtime: input.runtime,
    repo_path: input.repoPath,
    runtime_context: input.runtimeContext ? cloneRuntimeContext(input.runtimeContext) : null,
    ...createWorkerExecutionContext(input.task),
  };
}

export function createQualityGateWorkerExecutionRequest(input: {
  task: ExecutionNode;
  runtime: RuntimeState;
  repoPath?: string;
  runtimeContext?: WorkerRuntimeContext | null;
}): QualityGateWorkerExecutionRequest {
  return {
    roles: deriveQualityGateRoles(input.task),
    task: input.task,
    runtime: input.runtime,
    repo_path: input.repoPath,
    runtime_context: input.runtimeContext ? cloneRuntimeContext(input.runtimeContext) : null,
    ...createWorkerExecutionContext(input.task),
  };
}

export function applyWorkerExecutionContext(
  task: ExecutionNode,
  context: Partial<WorkerExecutionContext>,
): void {
  const normalized = createWorkerExecutionContext(context);

  task.changed_files = normalized.changed_files;
  task.blocker_category = normalized.blocker_category;
  task.blocker_message = normalized.blocker_message;
  task.implementation_evidence = normalized.implementation_evidence;
  task.test_evidence = normalized.test_evidence;
  task.review_feedback = normalized.review_feedback;
  task.commands_run = normalized.commands_run;
  task.test_results = normalized.test_results;
  task.risk_notes = normalized.risk_notes;
  task.suggested_status = normalized.suggested_status;
  task.delivery_metadata = normalized.delivery_metadata;
  task.prior_attempt = normalized.prior_attempt;
}

export function createWorkerRetryHandoff(
  source: Partial<WorkerExecutionContext>,
  attempt: number,
  status: WorkerAttemptStatus,
  summary: string,
): WorkerRetryHandoff {
  const context = createWorkerExecutionContext(source);

  return {
    attempt,
    status,
    summary,
    changed_files: context.changed_files,
    blocker_category: context.blocker_category,
    blocker_message: context.blocker_message,
    implementation_evidence: context.implementation_evidence,
    test_evidence: context.test_evidence,
    review_feedback: context.review_feedback,
    commands_run: context.commands_run,
    test_results: context.test_results,
    risk_notes: context.risk_notes,
    suggested_status: context.suggested_status,
    delivery_metadata: context.delivery_metadata,
  };
}

function deriveQualityGateRoles(task: Pick<ExecutionNode, 'quality_gate'>): Array<'test-agent' | 'review-agent'> {
  const roles: Array<'test-agent' | 'review-agent'> = [];

  if (task.quality_gate.test_required) roles.push('test-agent');
  if (task.quality_gate.review_required) roles.push('review-agent');

  return roles;
}

function cloneRetryHandoff(handoff: WorkerRetryHandoff): WorkerRetryHandoff {
  return {
    attempt: handoff.attempt,
    status: handoff.status,
    summary: handoff.summary,
    changed_files: [...handoff.changed_files],
    blocker_category: handoff.blocker_category,
    blocker_message: handoff.blocker_message,
    implementation_evidence: [...handoff.implementation_evidence],
    test_evidence: [...handoff.test_evidence],
    review_feedback: [...handoff.review_feedback],
    commands_run: [...handoff.commands_run],
    test_results: handoff.test_results.map(cloneTestResult),
    risk_notes: [...handoff.risk_notes],
    suggested_status: handoff.suggested_status,
    delivery_metadata: handoff.delivery_metadata ? cloneDeliveryMetadata(handoff.delivery_metadata) : null,
  };
}

function cloneTestResult(result: WorkerTestResult): WorkerTestResult {
  const cloned: WorkerTestResult = {
    name: result.name,
    status: result.status,
  };

  if (result.details !== undefined) {
    cloned.details = result.details;
  }

  return cloned;
}

function cloneDeliveryMetadata(metadata: WorkerDeliveryMetadata): WorkerDeliveryMetadata {
  return {
    branch_name: metadata.branch_name,
    commit_sha: metadata.commit_sha,
    pr_url: metadata.pr_url,
  };
}

function cloneRuntimeContext(runtimeContext: WorkerRuntimeContext): WorkerRuntimeContext {
  return {
    repo_context_summary: [...runtimeContext.repo_context_summary],
    environment_snapshot: {
      package_manager: runtimeContext.environment_snapshot.package_manager,
      package_manifest_path: runtimeContext.environment_snapshot.package_manifest_path,
      lockfile_path: runtimeContext.environment_snapshot.lockfile_path,
      build_command: runtimeContext.environment_snapshot.build_command,
      test_commands: [...runtimeContext.environment_snapshot.test_commands],
    },
    task_context_files: [...runtimeContext.task_context_files],
    verification_plan: {
      commands: [...runtimeContext.verification_plan.commands],
      environment_checks: [...runtimeContext.verification_plan.environment_checks],
      definition_of_done: [...runtimeContext.verification_plan.definition_of_done],
      reconsider_signals: [...runtimeContext.verification_plan.reconsider_signals],
      retry_handoff: runtimeContext.verification_plan.retry_handoff
        ? {
            attempt: runtimeContext.verification_plan.retry_handoff.attempt,
            status: runtimeContext.verification_plan.retry_handoff.status,
            summary: runtimeContext.verification_plan.retry_handoff.summary,
            blocker_category: runtimeContext.verification_plan.retry_handoff.blocker_category,
            blocker_message: runtimeContext.verification_plan.retry_handoff.blocker_message,
            commands_run: [...runtimeContext.verification_plan.retry_handoff.commands_run],
            review_feedback: [...runtimeContext.verification_plan.retry_handoff.review_feedback],
          }
        : null,
    },
    time_budget_hint: runtimeContext.time_budget_hint,
  };
}
