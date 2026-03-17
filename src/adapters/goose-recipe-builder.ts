import type { AssignedAgent } from '../schemas/planning.js';
import type { ExecutionNode } from '../schemas/runtime.js';
import type { WorkerRetryHandoff } from '../workers/contracts.js';

export interface GooseRecipeExecutionSpec {
  recipe_path: string;
  output_schema_path: string;
  inputs: {
    run_id: string;
    repo_path: string;
    task: {
      task_id: string;
      title: string;
      description: string;
      assigned_agent: AssignedAgent;
      acceptance_criteria: string[];
      changed_files: string[];
    };
    retry_context: WorkerRetryHandoff | null;
  };
}

const RECIPE_PATHS: Record<AssignedAgent, string> = {
  'frontend-agent': '.goose/recipes/frontend-implementation.yaml',
  'backend-agent': '.goose/recipes/backend-implementation.yaml',
};

const OUTPUT_SCHEMA_PATH = '.goose/recipes/shared/worker-output-schema.json';

export function buildGooseRecipeExecution(input: {
  role: AssignedAgent;
  task: ExecutionNode;
  runtimeRunId: string;
  repoPath: string;
  retryContext: WorkerRetryHandoff | null;
}): GooseRecipeExecutionSpec {
  return {
    recipe_path: RECIPE_PATHS[input.role],
    output_schema_path: OUTPUT_SCHEMA_PATH,
    inputs: {
      run_id: input.runtimeRunId,
      repo_path: input.repoPath,
      task: {
        task_id: input.task.task_id,
        title: input.task.title,
        description: input.task.description,
        assigned_agent: input.task.assigned_agent,
        acceptance_criteria: [...input.task.acceptance_criteria],
        changed_files: [...input.task.changed_files],
      },
      retry_context: input.retryContext,
    },
  };
}
