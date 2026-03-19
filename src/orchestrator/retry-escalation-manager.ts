import {
  DEFAULT_OPENCLAW_AVAILABLE_MODELS,
} from '../adapters/openclaw-model-resolver.js';
import { ModelRouter } from '../adapters/model-router.js';
import type { ModelResolution } from '../schemas/models.js';
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
  next_model_metadata?: ModelResolution;
  retry_count: number;
  reason: string;
}

export interface RetryManager {
  decide(task: ExecutionNode, cause: RetryCause): RetryDecision;
}

export interface RetryEscalationManagerOptions {
  availableModels?: string[];
  modelRouter?: ModelRouter;
}

export class RetryEscalationManager implements RetryManager {
  private readonly availableModels: string[];
  private readonly router: ModelRouter;

  constructor(options: RetryEscalationManagerOptions = {}) {
    this.availableModels = options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
    this.router = options.modelRouter ?? new ModelRouter();
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
        next_model_metadata: task.model_metadata,
        retry_count: task.retry_count + 1,
        reason: `Retrying ${task.task_id} on ${task.model} after ${cause}.`,
      };
    }

    const upgradedRoute = this.routeNextImplementationModel(
      task.assigned_agent,
      task.model,
      task.fallback_models,
    );
    if (upgradedRoute) {
      return {
        taskId: task.task_id,
        cause,
        action: 'retry_with_upgraded_model',
        next_status: 'pending',
        next_model: upgradedRoute.selectedModel,
        next_model_metadata: upgradedRoute.selectedModelMetadata,
        retry_count: task.retry_count + 1,
        reason: `Retry escalation for ${task.task_id}: switching from ${task.model} to ${upgradedRoute.selectedModel}.`,
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
      next_model_metadata: task.model_metadata,
      retry_count: task.retry_count,
      reason,
    };
  }

  private routeNextImplementationModel(
    agent: AssignedAgent,
    currentModel: string,
    fallbackModels?: string[] | null,
  ) {
    const preferredModels = Array.isArray(fallbackModels) && fallbackModels.length > 0
      ? fallbackModels
      : undefined;

    return this.router.routeNext(
      agent,
      currentModel,
      { availableModels: this.availableModels },
      { preferredModels },
    );
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
