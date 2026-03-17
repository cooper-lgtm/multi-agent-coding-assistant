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
  type WorkerBlockerCategory,
  type WorkerDeliveryMetadata,
  type WorkerRetryHandoff,
  type WorkerSuggestedStatus,
  type WorkerTestResult,
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

interface GooseStructuredWorkerOutput {
  status: ImplementationWorkerExecutionResult['status'];
  summary: string;
  changed_files?: string[];
  blocker_category?: WorkerBlockerCategory | null;
  blocker_message?: string | null;
  implementation_evidence?: string[];
  test_evidence?: string[];
  review_feedback?: string[];
  commands_run?: string[];
  test_results?: WorkerTestResult[];
  risk_notes?: string[];
  suggested_status?: WorkerSuggestedStatus | null;
  delivery_metadata?: WorkerDeliveryMetadata | null;
  prior_attempt?: WorkerRetryHandoff | null;
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
      if (isBlockedGooseFailure(gooseResult.stderr)) {
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
      const payload = parseStructuredWorkerPayload(JSON.parse(trimmed));

      if (!payload) {
        return null;
      }

      return this.createImplementationResult({
        role: request.payload.task.assigned_agent,
        context: {
          ...request.payload,
          ...payload,
        },
        status: payload.status,
        summary: payload.summary,
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

function parseStructuredWorkerPayload(raw: unknown): GooseStructuredWorkerOutput | null {
  if (!isRecord(raw)) {
    return null;
  }

  const status = raw.status;
  const summary = raw.summary;

  if (!isImplementationStatus(status) || typeof summary !== 'string') {
    return null;
  }

  const normalized: GooseStructuredWorkerOutput = {
    status,
    summary,
  };

  if (!copyOptionalStringArray(raw, normalized, 'changed_files')) return null;
  if (!copyOptionalNullableBlockerCategory(raw, normalized, 'blocker_category')) return null;
  if (!copyOptionalNullableString(raw, normalized, 'blocker_message')) return null;
  if (!copyOptionalStringArray(raw, normalized, 'implementation_evidence')) return null;
  if (!copyOptionalStringArray(raw, normalized, 'test_evidence')) return null;
  if (!copyOptionalStringArray(raw, normalized, 'review_feedback')) return null;
  if (!copyOptionalStringArray(raw, normalized, 'commands_run')) return null;
  if (!copyOptionalTestResults(raw, normalized, 'test_results')) return null;
  if (!copyOptionalStringArray(raw, normalized, 'risk_notes')) return null;
  if (!copyOptionalNullableSuggestedStatus(raw, normalized, 'suggested_status')) return null;
  if (!copyOptionalDeliveryMetadata(raw, normalized, 'delivery_metadata')) return null;
  if (!copyOptionalRetryHandoff(raw, normalized, 'prior_attempt')) return null;

  return normalized;
}

function isBlockedGooseFailure(stderr: string): boolean {
  return /enoent|missing|credential|prerequisite|not found|no such file|permission/i.test(stderr);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImplementationStatus(value: unknown): value is ImplementationWorkerExecutionResult['status'] {
  return value === 'implementation_done' || value === 'blocked' || value === 'failed';
}

function isSuggestedStatus(value: unknown): value is WorkerSuggestedStatus {
  return (
    value === 'implementation_done' ||
    value === 'blocked' ||
    value === 'failed' ||
    value === 'completed' ||
    value === 'needs_fix'
  );
}

function isBlockerCategory(value: unknown): value is WorkerBlockerCategory {
  return (
    value === 'requirements' ||
    value === 'repository' ||
    value === 'dependency' ||
    value === 'environment' ||
    value === 'quality' ||
    value === 'unknown'
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isWorkerTestResult(value: unknown): value is WorkerTestResult {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.status === 'pass' || value.status === 'fail' || value.status === 'skip' || value.status === 'pending') &&
    (value.details === undefined || typeof value.details === 'string')
  );
}

function isWorkerDeliveryMetadata(value: unknown): value is WorkerDeliveryMetadata {
  return (
    isRecord(value) &&
    (value.branch_name === undefined || value.branch_name === null || typeof value.branch_name === 'string') &&
    (value.commit_sha === undefined || value.commit_sha === null || typeof value.commit_sha === 'string') &&
    (value.pr_url === undefined || value.pr_url === null || typeof value.pr_url === 'string')
  );
}

function isWorkerRetryHandoff(value: unknown): value is WorkerRetryHandoff {
  return (
    isRecord(value) &&
    Number.isInteger(value.attempt) &&
    isSuggestedStatus(value.status) &&
    typeof value.summary === 'string' &&
    isNullableBlockerCategory(value.blocker_category) &&
    isNullableString(value.blocker_message) &&
    isStringArray(value.changed_files) &&
    isStringArray(value.implementation_evidence) &&
    isStringArray(value.test_evidence) &&
    isStringArray(value.review_feedback) &&
    isStringArray(value.commands_run) &&
    Array.isArray(value.test_results) &&
    value.test_results.every(isWorkerTestResult) &&
    isStringArray(value.risk_notes) &&
    isNullableSuggestedStatus(value.suggested_status) &&
    isNullableDeliveryMetadata(value.delivery_metadata)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableBlockerCategory(value: unknown): value is WorkerBlockerCategory | null {
  return value === null || isBlockerCategory(value);
}

function isNullableSuggestedStatus(value: unknown): value is WorkerSuggestedStatus | null {
  return value === null || isSuggestedStatus(value);
}

function isNullableDeliveryMetadata(value: unknown): value is WorkerDeliveryMetadata | null {
  return value === null || isWorkerDeliveryMetadata(value);
}

function copyOptionalStringArray(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'changed_files' | 'implementation_evidence' | 'test_evidence' | 'review_feedback' | 'commands_run' | 'risk_notes',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!isStringArray(value)) {
    return false;
  }

  target[key] = [...value];
  return true;
}

function copyOptionalNullableString(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'blocker_message',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!isNullableString(value)) {
    return false;
  }

  target[key] = value;
  return true;
}

function copyOptionalNullableBlockerCategory(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'blocker_category',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!isNullableBlockerCategory(value)) {
    return false;
  }

  target[key] = value;
  return true;
}

function copyOptionalTestResults(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'test_results',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!Array.isArray(value) || !value.every(isWorkerTestResult)) {
    return false;
  }

  target[key] = value.map((result) => ({
    name: result.name,
    status: result.status,
    details: result.details,
  }));
  return true;
}

function copyOptionalNullableSuggestedStatus(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'suggested_status',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!isNullableSuggestedStatus(value)) {
    return false;
  }

  target[key] = value;
  return true;
}

function copyOptionalDeliveryMetadata(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'delivery_metadata',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (!isNullableDeliveryMetadata(value)) {
    return false;
  }

  target[key] = value
    ? {
        branch_name: value.branch_name,
        commit_sha: value.commit_sha,
        pr_url: value.pr_url,
      }
    : null;
  return true;
}

function copyOptionalRetryHandoff(
  source: Record<string, unknown>,
  target: GooseStructuredWorkerOutput,
  key: 'prior_attempt',
): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return true;
  }

  const value = source[key];
  if (value !== null && !isWorkerRetryHandoff(value)) {
    return false;
  }

  target[key] = value
    ? {
        attempt: value.attempt,
        status: value.status,
        summary: value.summary,
        changed_files: [...value.changed_files],
        blocker_category: value.blocker_category,
        blocker_message: value.blocker_message,
        implementation_evidence: [...value.implementation_evidence],
        test_evidence: [...value.test_evidence],
        review_feedback: [...value.review_feedback],
        commands_run: [...value.commands_run],
        test_results: value.test_results.map((result) => ({
          name: result.name,
          status: result.status,
          details: result.details,
        })),
        risk_notes: [...value.risk_notes],
        suggested_status: value.suggested_status,
        delivery_metadata: value.delivery_metadata
          ? {
              branch_name: value.delivery_metadata.branch_name,
              commit_sha: value.delivery_metadata.commit_sha,
              pr_url: value.delivery_metadata.pr_url,
            }
          : null,
      }
    : null;
  return true;
}
