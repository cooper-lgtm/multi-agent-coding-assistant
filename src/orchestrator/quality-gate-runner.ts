import { ModelRouter } from '../adapters/model-router.js';
import { DEFAULT_OPENCLAW_AVAILABLE_MODELS } from '../adapters/openclaw-model-resolver.js';
import type { QualityStatus, ReviewStatus } from '../schemas/planning.js';
import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import {
  createQualityGateWorkerExecutionRequest,
  type QualityGateWorkerExecutionResult,
  type WorkerBlockerCategory,
} from '../workers/contracts.js';

export interface QualityGateRunResult extends Omit<QualityGateWorkerExecutionResult, 'roles'> {
  taskId: string;
  roles: Array<'test-agent' | 'review-agent'>;
  test_model: string | null;
  review_model: string | null;
}

export interface QualityGateRunner {
  run(task: ExecutionNode, runtime: RuntimeState): Promise<QualityGateRunResult>;
}

export interface MockQualityGateDecision
  extends Partial<Omit<QualityGateRunResult, 'taskId' | 'roles' | 'test_model' | 'review_model'>> {
  status: QualityGateRunResult['status'];
  summary: string;
  test_status: QualityStatus;
  review_status: ReviewStatus;
  test_model?: string | null;
  review_model?: string | null;
}

export interface MockQualityGateRunnerOptions {
  availableModels?: string[];
  taskDecisions?: Record<string, MockQualityGateDecision[]>;
}

export class MockQualityGateRunner implements QualityGateRunner {
  private readonly availableModels: string[];
  private readonly taskDecisions: Record<string, MockQualityGateDecision[]>;
  private readonly taskIndices = new Map<string, number>();
  private readonly router = new ModelRouter();

  constructor(options: MockQualityGateRunnerOptions = {}) {
    this.availableModels = options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
    this.taskDecisions = options.taskDecisions ?? {};
  }

  async run(task: ExecutionNode, _runtime: RuntimeState): Promise<QualityGateRunResult> {
    const request = createQualityGateWorkerExecutionRequest({ task, runtime: _runtime });
    const sequence = this.taskDecisions[task.task_id] ?? [];
    const index = this.taskIndices.get(task.task_id) ?? 0;
    const fallbackDecision = this.buildDefaultDecision(task);
    const decision = sequence[index] ?? fallbackDecision;
    const testModel = this.resolveOptionalModelOverride(decision, 'test_model', fallbackDecision.test_model);
    const reviewModel = this.resolveOptionalModelOverride(decision, 'review_model', fallbackDecision.review_model);

    this.taskIndices.set(task.task_id, index + 1);

    return {
      taskId: task.task_id,
      roles: request.roles,
      status: decision.status,
      summary: decision.summary,
      changed_files:
        decision.changed_files ??
        (request.changed_files.length > 0 ? request.changed_files : [...(task.changed_files ?? [])]),
      blocker_category: this.resolveBlockerCategory(decision, request, task),
      blocker_message: this.resolveBlockerMessage(decision, task),
      implementation_evidence: decision.implementation_evidence ?? request.implementation_evidence,
      test_evidence:
        decision.test_evidence ??
        this.resolveTestEvidence(task, decision, testModel),
      review_feedback:
        decision.review_feedback ??
        this.resolveReviewFeedback(task, decision, reviewModel),
      commands_run: decision.commands_run ?? request.commands_run,
      test_results: decision.test_results ?? request.test_results,
      risk_notes: decision.risk_notes ?? request.risk_notes,
      suggested_status: this.resolveSuggestedStatus(decision, request.suggested_status),
      delivery_metadata: this.resolveDeliveryMetadata(decision, request.delivery_metadata),
      prior_attempt: decision.prior_attempt ?? request.prior_attempt,
      test_status: decision.test_status,
      review_status: decision.review_status,
      test_model: testModel,
      review_model: reviewModel,
    };
  }

  private resolveOptionalModelOverride(
    decision: MockQualityGateDecision,
    key: 'test_model' | 'review_model',
    fallbackModel: string | null,
  ): string | null {
    return Object.prototype.hasOwnProperty.call(decision, key) ? (decision[key] ?? null) : fallbackModel;
  }

  private buildDefaultDecision(task: ExecutionNode): QualityGateRunResult {
    const testModel = task.quality_gate.test_required
      ? this.router.route('test-agent', { availableModels: this.availableModels }).selectedModel
      : null;
    const reviewModel = task.quality_gate.review_required
      ? this.router.route('review-agent', { availableModels: this.availableModels }).selectedModel
      : null;

    return {
      taskId: task.task_id,
      roles: [],
      status: 'completed',
      summary: `Quality gates passed for ${task.title}.`,
      changed_files: [...(task.changed_files ?? [])],
      blocker_category: null,
      blocker_message: null,
      implementation_evidence: [...(task.implementation_evidence ?? [])],
      test_evidence: this.buildDefaultTestEvidence(task, task.quality_gate.test_required ? 'pass' : 'skipped', testModel),
      review_feedback: this.buildDefaultReviewFeedback(
        task,
        task.quality_gate.review_required ? 'approved' : 'skipped',
        reviewModel,
      ),
      commands_run: [...(task.commands_run ?? [])],
      test_results: structuredClone(task.test_results ?? []),
      risk_notes: [...(task.risk_notes ?? [])],
      suggested_status: task.suggested_status ?? null,
      delivery_metadata: task.delivery_metadata ? structuredClone(task.delivery_metadata) : null,
      prior_attempt: task.prior_attempt ?? null,
      test_status: task.quality_gate.test_required ? 'pass' : 'skipped',
      review_status: task.quality_gate.review_required ? 'approved' : 'skipped',
      test_model: testModel,
      review_model: reviewModel,
    };
  }

  private buildDefaultTestEvidence(
    task: ExecutionNode,
    status: QualityStatus,
    model: string | null,
  ): string[] {
    if (status === 'skipped') return [];
    if (status === 'pending') return [`test-agent pending for ${task.task_id}${model ? ` on ${model}` : ''}.`];
    if (status === 'fail') return [`test-agent failed for ${task.task_id}${model ? ` on ${model}` : ''}.`];
    return [`test-agent passed for ${task.task_id}${model ? ` on ${model}` : ''}.`];
  }

  private buildDefaultReviewFeedback(
    task: ExecutionNode,
    status: ReviewStatus,
    model: string | null,
  ): string[] {
    if (status === 'skipped') return [];
    if (status === 'pending') {
      return [`review-agent pending for ${task.task_id}${model ? ` on ${model}` : ''}.`];
    }
    if (status === 'needs_fix') {
      return [`review-agent requested changes for ${task.task_id}${model ? ` on ${model}` : ''}.`];
    }

    return [`review-agent approved ${task.task_id}${model ? ` on ${model}` : ''}.`];
  }

  private resolveTestEvidence(
    task: ExecutionNode,
    decision: MockQualityGateDecision,
    model: string | null,
  ): string[] {
    if (decision.status !== 'completed' && decision.test_status === 'fail') {
      return [decision.summary];
    }

    return this.buildDefaultTestEvidence(task, decision.test_status, model);
  }

  private resolveReviewFeedback(
    task: ExecutionNode,
    decision: MockQualityGateDecision,
    model: string | null,
  ): string[] {
    if (decision.review_status === 'needs_fix') {
      return [decision.summary];
    }

    return this.buildDefaultReviewFeedback(task, decision.review_status, model);
  }

  private resolveBlockerCategory(
    decision: MockQualityGateDecision,
    request: ReturnType<typeof createQualityGateWorkerExecutionRequest>,
    task: ExecutionNode,
  ): WorkerBlockerCategory | null {
    if (Object.prototype.hasOwnProperty.call(decision, 'blocker_category')) {
      return decision.blocker_category ?? null;
    }

    if (decision.status === 'completed') return null;
    if (request.prior_attempt?.blocker_category) return request.prior_attempt.blocker_category;
    return task.blocker_category ?? 'quality';
  }

  private resolveBlockerMessage(decision: MockQualityGateDecision, task: ExecutionNode): string | null {
    if (Object.prototype.hasOwnProperty.call(decision, 'blocker_message')) {
      return decision.blocker_message ?? null;
    }

    if (decision.status === 'completed') return null;
    return decision.summary || task.error;
  }

  private resolveSuggestedStatus(
    decision: MockQualityGateDecision,
    fallback: QualityGateRunResult['suggested_status'],
  ): QualityGateRunResult['suggested_status'] {
    return Object.prototype.hasOwnProperty.call(decision, 'suggested_status')
      ? (decision.suggested_status ?? null)
      : fallback;
  }

  private resolveDeliveryMetadata(
    decision: MockQualityGateDecision,
    fallback: QualityGateRunResult['delivery_metadata'],
  ): QualityGateRunResult['delivery_metadata'] {
    return Object.prototype.hasOwnProperty.call(decision, 'delivery_metadata')
      ? (decision.delivery_metadata ?? null)
      : fallback;
  }
}
