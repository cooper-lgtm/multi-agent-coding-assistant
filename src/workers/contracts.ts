import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';

export interface WorkerExecutionInput {
  task: ExecutionNode;
  runtime: RuntimeState;
  repoPath: string;
}

export interface WorkerExecutionOutput {
  status: 'implementation_done' | 'blocked' | 'failed';
  summary: string;
  changedFiles?: string[];
}
