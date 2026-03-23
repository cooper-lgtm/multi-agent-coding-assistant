import type { AssignedAgent } from '../schemas/planning.js';
import type { ExecutionNode } from '../schemas/runtime.js';
import type { WorkerRetryHandoff, WorkerRuntimeContext } from '../workers/contracts.js';

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
    runtime_context: WorkerRuntimeContext | null;
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
  runtimeContext?: WorkerRuntimeContext | null;
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
      runtime_context: input.runtimeContext ? cloneRuntimeContext(input.runtimeContext) : null,
    },
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
