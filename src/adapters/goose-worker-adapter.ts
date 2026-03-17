import {
  type OpenClawWorkerRoleAdapter,
  type OpenClawWorkerRoleRequest,
  type OpenClawWorkerRoleResult,
  createOpenClawRoleError,
  createOpenClawRoleSuccess,
} from './openclaw-runtime-adapter.js';
import { buildGooseRecipeExecution } from './goose-recipe-builder.js';
import {
  createWorkerExecutionOutput,
  type ImplementationWorkerExecutionResult,
} from '../workers/contracts.js';
import {
  runGooseProcess,
  type GooseProcessInvocation,
  type GooseProcessResult,
} from './goose-process-runner.js';

export interface GooseWorkerAdapterOptions {
  runGoose?: (invocation: GooseProcessInvocation) => Promise<GooseProcessResult>;
  cwd?: string;
}

export class GooseWorkerAdapter implements OpenClawWorkerRoleAdapter {
  private readonly runGoose;
  private readonly cwd;

  constructor(options: GooseWorkerAdapterOptions = {}) {
    this.runGoose = options.runGoose ?? runGooseProcess;
    this.cwd = options.cwd;
  }

  async execute(request: OpenClawWorkerRoleRequest): Promise<OpenClawWorkerRoleResult<ImplementationWorkerExecutionResult>> {
    if (request.role !== 'frontend-agent' && request.role !== 'backend-agent') {
      return createOpenClawRoleError({
        request,
        code: 'invalid_payload',
        message: `Goose worker adapter only supports implementation roles, received ${request.role}.`,
        retryable: false,
      });
    }

    const spec = buildGooseRecipeExecution({
      role: request.role,
      task: {
        ...request.payload.task,
        model: request.model.logical_model,
        model_metadata: request.model,
        complexity: 'medium',
        risk: 'medium',
        retry_count: request.payload.runtime.retry_count,
        max_retries: request.payload.runtime.max_retries,
        escalation_policy: {
          on_first_failure: 'retry_same_model',
          on_second_failure: 'upgrade_model',
          on_third_failure: 'manual_orchestrator_decision',
        },
        result: null,
        error: request.payload.prior_error,
        ...request.payload,
      } as never,
      runtimeRunId: request.payload.runtime.run_id,
      repoPath: request.payload.repo_path,
      retryContext: request.payload.prior_attempt,
    });

    const gooseResult = await this.runGoose({ ...spec, cwd: this.cwd });

    if (!gooseResult.ok) {
      if (/missing|credential|prerequisite|not found|no such file|permission/i.test(gooseResult.stderr)) {
        const blocked = this.createImplementationResult({
          role: request.payload.task.assigned_agent,
          context: {
            ...request.payload,
            blocker_category: 'environment',
            blocker_message: gooseResult.stderr.trim() || 'Goose execution blocked before implementation started.',
          },
          status: 'blocked',
          summary: 'Goose execution blocked by missing prerequisites.',
        });

        return createOpenClawRoleSuccess({
          request,
          summary: blocked.summary,
          output: blocked,
        });
      }

      return createOpenClawRoleError({
        request,
        code: 'execution_failed',
        message: gooseResult.stderr.trim() || 'Goose execution failed.',
        retryable: true,
      });
    }

    const parsed = this.parseWorkerOutput(gooseResult.stdout, request);

    if (!parsed) {
      const failed = this.createImplementationResult({
        role: request.payload.task.assigned_agent,
        context: {
          ...request.payload,
          blocker_category: 'unknown',
          blocker_message: 'Goose output was not valid structured worker output.',
          implementation_evidence: [
            ...request.payload.implementation_evidence,
            `Malformed goose stdout: ${gooseResult.stdout.trim() || '<empty>'}`,
          ],
        },
        status: 'failed',
        summary: 'Goose output was not valid structured worker output.',
      });

      return createOpenClawRoleSuccess({
        request,
        summary: failed.summary,
        output: failed,
      });
    }

    return createOpenClawRoleSuccess({
      request,
      summary: parsed.summary,
      output: parsed,
    });
  }

  private parseWorkerOutput(
    stdout: string,
    request: OpenClawWorkerRoleRequest,
  ): ImplementationWorkerExecutionResult | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      const status = payload.status;
      const summary = payload.summary;

      if (
        (status !== 'implementation_done' && status !== 'blocked' && status !== 'failed') ||
        typeof summary !== 'string'
      ) {
        return null;
      }

      return this.createImplementationResult({
        role: request.payload.task.assigned_agent,
        context: {
          ...request.payload,
          ...(payload as Partial<ImplementationWorkerExecutionResult>),
        },
        status,
        summary,
      });
    } catch {
      return null;
    }
  }

  private createImplementationResult(input: {
    role: ImplementationWorkerExecutionResult['role'];
    context: Partial<ImplementationWorkerExecutionResult> | OpenClawWorkerRoleRequest['payload'];
    status: ImplementationWorkerExecutionResult['status'];
    summary: string;
  }): ImplementationWorkerExecutionResult {
    const output = createWorkerExecutionOutput({
      context: input.context,
      status: input.status,
      summary: input.summary,
    });

    return {
      role: input.role,
      status: input.status,
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
