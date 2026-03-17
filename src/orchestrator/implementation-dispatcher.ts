import type { AssignedAgent } from '../schemas/planning.js';
import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import type {
  OpenClawWorkerRoleRequest,
  OpenClawWorkerRoleResult,
} from '../adapters/openclaw-runtime-adapter.js';
import {
  createOpenClawWorkerRoleRequest,
} from '../adapters/openclaw-runtime-adapter.js';
import {
  createImplementationWorkerExecutionRequest,
  type ImplementationWorkerExecutionResult,
  type WorkerBlockerCategory,
} from '../workers/contracts.js';

export interface ImplementationDispatchResult extends Omit<ImplementationWorkerExecutionResult, 'role'> {
  taskId: string;
  role: AssignedAgent;
}

export interface ImplementationDispatcher {
  dispatch(task: ExecutionNode, runtime: RuntimeState): Promise<ImplementationDispatchResult>;
}

export interface MockImplementationDecision extends Partial<Omit<ImplementationDispatchResult, 'taskId' | 'role'>> {
  status: ImplementationDispatchResult['status'];
  summary: string;
}

export interface MockImplementationDispatcherOptions {
  taskDecisions?: Record<string, MockImplementationDecision[]>;
}

export interface GooseBackedImplementationDispatcherOptions {
  executeRole: (
    request: OpenClawWorkerRoleRequest,
  ) => Promise<OpenClawWorkerRoleResult<ImplementationWorkerExecutionResult>>;
  repoPath: string;
}

export class MockImplementationDispatcher implements ImplementationDispatcher {
  private readonly taskDecisions: Record<string, MockImplementationDecision[]>;
  private readonly taskIndices = new Map<string, number>();

  constructor(options: MockImplementationDispatcherOptions = {}) {
    this.taskDecisions = options.taskDecisions ?? {};
  }

  async dispatch(task: ExecutionNode, _runtime: RuntimeState): Promise<ImplementationDispatchResult> {
    const request = createImplementationWorkerExecutionRequest({ task, runtime: _runtime });
    const sequence = this.taskDecisions[task.task_id] ?? [];
    const index = this.taskIndices.get(task.task_id) ?? 0;
    const decision = sequence[index] ?? {
      status: 'implementation_done' as const,
      summary: `Implementation completed for ${task.title}.`,
    };

    this.taskIndices.set(task.task_id, index + 1);

    const changedFiles =
      decision.changed_files ?? (request.changed_files.length > 0 ? request.changed_files : [`src/mock/${task.task_id}.ts`]);
    const blockerCategory = this.resolveBlockerCategory(decision, request, task);
    const blockerMessage = this.resolveBlockerMessage(decision, blockerCategory, task);
    const implementationEvidence =
      decision.implementation_evidence ??
      [decision.summary, `Attempt ${task.retry_count + 1} finished implementation for ${task.task_id}.`];

    return {
      taskId: task.task_id,
      role: task.assigned_agent,
      status: decision.status,
      summary: decision.summary,
      changed_files: changedFiles,
      blocker_category: blockerCategory,
      blocker_message: blockerMessage,
      implementation_evidence: implementationEvidence,
      test_evidence: decision.test_evidence ?? request.test_evidence,
      review_feedback: decision.review_feedback ?? request.review_feedback,
      commands_run: decision.commands_run ?? request.commands_run,
      test_results: decision.test_results ?? request.test_results,
      risk_notes: decision.risk_notes ?? request.risk_notes,
      suggested_status: decision.suggested_status ?? decision.status,
      delivery_metadata: this.resolveDeliveryMetadata(decision, request.delivery_metadata),
      prior_attempt: decision.prior_attempt ?? request.prior_attempt,
    };
  }

  private resolveBlockerCategory(
    decision: MockImplementationDecision,
    request: ReturnType<typeof createImplementationWorkerExecutionRequest>,
    task: ExecutionNode,
  ): WorkerBlockerCategory | null {
    if (Object.prototype.hasOwnProperty.call(decision, 'blocker_category')) {
      return decision.blocker_category ?? null;
    }

    if (decision.status === 'implementation_done') return null;
    if (request.prior_attempt?.blocker_category) return request.prior_attempt.blocker_category;
    if (task.status === 'blocked') return task.blocker_category;

    return 'unknown';
  }

  private resolveBlockerMessage(
    decision: MockImplementationDecision,
    blockerCategory: WorkerBlockerCategory | null,
    task: ExecutionNode,
  ): string | null {
    if (Object.prototype.hasOwnProperty.call(decision, 'blocker_message')) {
      return decision.blocker_message ?? null;
    }

    if (!blockerCategory) return null;
    if (decision.status === 'implementation_done') return null;
    return decision.summary || task.error;
  }

  private resolveDeliveryMetadata(
    decision: MockImplementationDecision,
    fallback: ImplementationDispatchResult['delivery_metadata'],
  ): ImplementationDispatchResult['delivery_metadata'] {
    return Object.prototype.hasOwnProperty.call(decision, 'delivery_metadata')
      ? (decision.delivery_metadata ?? null)
      : fallback;
  }
}

export class GooseBackedImplementationDispatcher implements ImplementationDispatcher {
  private readonly executeRole: GooseBackedImplementationDispatcherOptions['executeRole'];
  private readonly repoPath: string;

  constructor(options: GooseBackedImplementationDispatcherOptions) {
    this.executeRole = options.executeRole;
    this.repoPath = options.repoPath;
  }

  async dispatch(task: ExecutionNode, runtime: RuntimeState): Promise<ImplementationDispatchResult> {
    const request = createOpenClawWorkerRoleRequest({
      role: task.assigned_agent,
      task,
      runtime,
      repoPath: this.repoPath,
      prompt: buildImplementationPrompt(task.assigned_agent),
    });
    const response = await this.executeRole(request);

    if (!response.ok) {
      return {
        taskId: task.task_id,
        role: task.assigned_agent,
        status: 'failed',
        summary: response.error.message,
        changed_files: [...task.changed_files],
        blocker_category: response.error.retryable ? 'unknown' : 'environment',
        blocker_message: response.error.message,
        implementation_evidence: [response.error.message],
        test_evidence: [...task.test_evidence],
        review_feedback: [...task.review_feedback],
        commands_run: [...task.commands_run],
        test_results: structuredClone(task.test_results),
        risk_notes: [...task.risk_notes],
        suggested_status: 'failed',
        delivery_metadata: task.delivery_metadata ? structuredClone(task.delivery_metadata) : null,
        prior_attempt: task.prior_attempt ? structuredClone(task.prior_attempt) : null,
      };
    }
    const output = response.output;

    return {
      taskId: task.task_id,
      role: output.role,
      status: output.status,
      summary: output.summary,
      changed_files: output.changed_files,
      blocker_category: output.blocker_category,
      blocker_message: output.blocker_message,
      implementation_evidence: output.implementation_evidence,
      test_evidence: output.test_evidence,
      review_feedback: output.review_feedback,
      commands_run: output.commands_run,
      test_results: output.test_results,
      risk_notes: output.risk_notes,
      suggested_status: output.suggested_status,
      delivery_metadata: output.delivery_metadata,
      prior_attempt: output.prior_attempt,
    };
  }
}

function buildImplementationPrompt(role: AssignedAgent): OpenClawWorkerRoleRequest['prompt'] {
  return {
    prompt_id: role,
    prompt_path: `prompts/${role}.md`,
  };
}
