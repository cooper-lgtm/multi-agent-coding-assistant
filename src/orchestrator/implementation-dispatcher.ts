import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';

export interface ImplementationDispatchResult {
  taskId: string;
  status: 'implementation_done' | 'blocked' | 'failed';
  summary: string;
  changed_files: string[];
}

export interface ImplementationDispatcher {
  dispatch(task: ExecutionNode, runtime: RuntimeState): Promise<ImplementationDispatchResult>;
}

export type MockImplementationDecision = Omit<ImplementationDispatchResult, 'taskId' | 'changed_files'> & {
  changed_files?: string[];
};

export interface MockImplementationDispatcherOptions {
  taskDecisions?: Record<string, MockImplementationDecision[]>;
}

export class MockImplementationDispatcher implements ImplementationDispatcher {
  private readonly taskDecisions: Record<string, MockImplementationDecision[]>;
  private readonly taskIndices = new Map<string, number>();

  constructor(options: MockImplementationDispatcherOptions = {}) {
    this.taskDecisions = options.taskDecisions ?? {};
  }

  async dispatch(task: ExecutionNode, _runtime: RuntimeState): Promise<ImplementationDispatchResult> {
    const sequence = this.taskDecisions[task.task_id] ?? [];
    const index = this.taskIndices.get(task.task_id) ?? 0;
    const decision = sequence[index] ?? {
      status: 'implementation_done' as const,
      summary: `Implementation completed for ${task.title}.`,
      changed_files: [`src/mock/${task.task_id}.ts`],
    };

    this.taskIndices.set(task.task_id, index + 1);

    return {
      taskId: task.task_id,
      status: decision.status,
      summary: decision.summary,
      changed_files: decision.changed_files ?? [`src/mock/${task.task_id}.ts`],
    };
  }
}
