import { ModelRouter } from '../adapters/model-router.js';
import type { AssignedAgent, RuntimeTaskStatus } from '../schemas/planning.js';
import type { ExecutionNode } from '../schemas/runtime.js';

export type RetryCause =
  | 'implementation_failed'
  | 'implementation_blocked'
  | 'quality_failed'
  | 'quality_needs_fix';

export type RetryAction =
  | 'retry_same_model'
  | 'retry_with_upgraded_model'
  | 'keep_terminal_status';

export interface RetryDecision {
  taskId: string;
  cause: RetryCause;
  action: RetryAction;
  next_status: RuntimeTaskStatus;
  next_model: string;
  retry_count: number;
  reason: string;
}

export interface RetryManager {
  decide(task: ExecutionNode, cause: RetryCause): RetryDecision;
}

export interface RetryEscalationManagerOptions {
  availableModels?: string[];
}

export class RetryEscalationManager implements RetryManager {
  private readonly availableModels: string[];
  private readonly router = new ModelRouter();

  constructor(options: RetryEscalationManagerOptions = {}) {
    this.availableModels = options.availableModels ?? ['gpt-5.4', 'codex', 'gemini', 'claude'];
  }

  decide(task: ExecutionNode, cause: RetryCause): RetryDecision {
    if (cause === 'implementation_blocked') {
      return this.keepTerminalStatus(task, cause, 'blocked', `Task ${task.task_id} is blocked.`);
    }

    if (task.retry_count >= task.max_retries) {
      const terminalStatus = this.toTerminalStatus(cause);
      return this.keepTerminalStatus(
        task,
        cause,
        terminalStatus,
        `Retry budget exhausted for ${task.task_id}; keeping ${terminalStatus}.`,
      );
    }

    if (task.retry_count === 0) {
      return {
        taskId: task.task_id,
        cause,
        action: 'retry_same_model',
        next_status: 'pending',
        next_model: task.model,
        retry_count: task.retry_count + 1,
        reason: `Retrying ${task.task_id} on ${task.model} after ${cause}.`,
      };
    }

    const upgradedModel = this.routeNextImplementationModel(task.assigned_agent, task.model);
    if (upgradedModel) {
      return {
        taskId: task.task_id,
        cause,
        action: 'retry_with_upgraded_model',
        next_status: 'pending',
        next_model: upgradedModel,
        retry_count: task.retry_count + 1,
        reason: `Retry escalation for ${task.task_id}: switching from ${task.model} to ${upgradedModel}.`,
      };
    }

    const terminalStatus = this.toTerminalStatus(cause);
    return this.keepTerminalStatus(
      task,
      cause,
      terminalStatus,
      `No explicit fallback model remains for ${task.task_id}; keeping ${terminalStatus}.`,
    );
  }

  private keepTerminalStatus(
    task: ExecutionNode,
    cause: RetryCause,
    status: RuntimeTaskStatus,
    reason: string,
  ): RetryDecision {
    return {
      taskId: task.task_id,
      cause,
      action: 'keep_terminal_status',
      next_status: status,
      next_model: task.model,
      retry_count: task.retry_count,
      reason,
    };
  }

  private routeNextImplementationModel(agent: AssignedAgent, currentModel: string): string | null {
    return this.router.routeNext(agent, currentModel, { availableModels: this.availableModels })
      ?.selectedModel ?? null;
  }

  private toTerminalStatus(cause: RetryCause): RuntimeTaskStatus {
    switch (cause) {
      case 'implementation_blocked':
        return 'blocked';
      case 'quality_needs_fix':
        return 'needs_fix';
      case 'quality_failed':
      case 'implementation_failed':
        return 'failed';
    }
  }
}
