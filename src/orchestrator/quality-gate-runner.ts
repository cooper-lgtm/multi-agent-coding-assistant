import { ModelRouter } from '../adapters/model-router.js';
import type { QualityStatus, ReviewStatus } from '../schemas/planning.js';
import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';

export interface QualityGateRunResult {
  taskId: string;
  status: 'completed' | 'needs_fix' | 'failed';
  summary: string;
  test_status: QualityStatus;
  review_status: ReviewStatus;
  test_model: string | null;
  review_model: string | null;
}

export interface QualityGateRunner {
  run(task: ExecutionNode, runtime: RuntimeState): Promise<QualityGateRunResult>;
}

export type MockQualityGateDecision = Omit<
  QualityGateRunResult,
  'taskId' | 'test_model' | 'review_model'
> & {
  test_model?: string | null;
  review_model?: string | null;
};

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
    this.availableModels = options.availableModels ?? ['gpt-5.4', 'codex', 'gemini', 'claude'];
    this.taskDecisions = options.taskDecisions ?? {};
  }

  async run(task: ExecutionNode, _runtime: RuntimeState): Promise<QualityGateRunResult> {
    const sequence = this.taskDecisions[task.task_id] ?? [];
    const index = this.taskIndices.get(task.task_id) ?? 0;
    const fallbackDecision = this.buildDefaultDecision(task);
    const decision = sequence[index] ?? fallbackDecision;

    this.taskIndices.set(task.task_id, index + 1);

    return {
      taskId: task.task_id,
      status: decision.status,
      summary: decision.summary,
      test_status: decision.test_status,
      review_status: decision.review_status,
      test_model: this.resolveOptionalModelOverride(decision, 'test_model', fallbackDecision.test_model),
      review_model: this.resolveOptionalModelOverride(
        decision,
        'review_model',
        fallbackDecision.review_model,
      ),
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
      status: 'completed',
      summary: `Quality gates passed for ${task.title}.`,
      test_status: task.quality_gate.test_required ? 'pass' : 'skipped',
      review_status: task.quality_gate.review_required ? 'approved' : 'skipped',
      test_model: testModel,
      review_model: reviewModel,
    };
  }
}
