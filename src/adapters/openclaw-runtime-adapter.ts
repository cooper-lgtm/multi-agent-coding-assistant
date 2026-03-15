import type { ModelResolution } from '../schemas/models.js';
import type {
  PlanningRoleName,
  PlanningRequest,
  RequestedPlanningMode,
  ResolvedPlanningMode,
  AssignedAgent,
} from '../schemas/planning.js';
import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import { DEFAULT_OPENCLAW_AVAILABLE_MODELS, OpenClawModelResolver } from './openclaw-model-resolver.js';

export type OpenClawWorkerRoleName = AssignedAgent | 'test-agent' | 'review-agent';
export type OpenClawRoleName = PlanningRoleName | OpenClawWorkerRoleName;
export type OpenClawRoleType = 'planning' | 'worker';

export interface OpenClawPromptReference {
  prompt_id: string;
  prompt_path: string;
}

export interface OpenClawPlanningTaskPayload {
  request: string;
  project_summary: string;
  relevant_context: string[];
  planning_mode: RequestedPlanningMode | ResolvedPlanningMode;
  constraints: string[];
  existing_artifacts: string[];
}

export interface OpenClawWorkerTaskPayload {
  repo_path: string;
  task: {
    task_id: string;
    title: string;
    description: string;
    assigned_agent: AssignedAgent;
    depends_on: string[];
    acceptance_criteria: string[];
    quality_gate: ExecutionNode['quality_gate'];
    status: ExecutionNode['status'];
  };
  runtime: {
    run_id: string;
    epic: string;
    planning_mode: RuntimeState['graph']['planning_mode'];
    retry_count: number;
    max_retries: number;
  };
  prior_error: string | null;
}

export interface OpenClawRequestMetadata {
  run_id?: string;
  task_id?: string;
  attempt: number;
  prompt_language: 'en';
}

export interface OpenClawRoleRequestEnvelope<TPayload, TRole extends OpenClawRoleName> {
  envelope_version: 'openclaw.role-exec.v1';
  role_type: OpenClawRoleType;
  role: TRole;
  model: ModelResolution;
  prompt: OpenClawPromptReference;
  payload: TPayload;
  metadata: OpenClawRequestMetadata;
}

export type OpenClawPlanningRoleRequest = OpenClawRoleRequestEnvelope<
  OpenClawPlanningTaskPayload,
  PlanningRoleName
>;

export type OpenClawWorkerRoleRequest = OpenClawRoleRequestEnvelope<
  OpenClawWorkerTaskPayload,
  OpenClawWorkerRoleName
>;

export interface OpenClawAdapterSessionMetadata {
  adapter: string;
  session_id?: string;
}

export interface OpenClawRoleSuccessEnvelope<TOutput, TRole extends OpenClawRoleName> {
  envelope_version: 'openclaw.role-exec.v1';
  ok: true;
  role_type: OpenClawRoleType;
  role: TRole;
  model: ModelResolution;
  summary: string;
  output: TOutput;
  session?: OpenClawAdapterSessionMetadata;
}

export interface OpenClawExecutionError {
  code: 'adapter_unavailable' | 'execution_failed' | 'invalid_payload' | 'model_unavailable';
  message: string;
  retryable: boolean;
  details?: Record<string, string>;
}

export interface OpenClawRoleErrorEnvelope<TRole extends OpenClawRoleName> {
  envelope_version: 'openclaw.role-exec.v1';
  ok: false;
  role_type: OpenClawRoleType;
  role: TRole;
  model: ModelResolution;
  error: OpenClawExecutionError;
}

export type OpenClawPlanningRoleResult<TOutput = unknown> =
  | OpenClawRoleSuccessEnvelope<TOutput, PlanningRoleName>
  | OpenClawRoleErrorEnvelope<PlanningRoleName>;

export type OpenClawWorkerRoleResult<TOutput = unknown> =
  | OpenClawRoleSuccessEnvelope<TOutput, OpenClawWorkerRoleName>
  | OpenClawRoleErrorEnvelope<OpenClawWorkerRoleName>;

export interface OpenClawPlanningRoleAdapter {
  execute(request: OpenClawPlanningRoleRequest): Promise<OpenClawPlanningRoleResult>;
}

export interface OpenClawWorkerRoleAdapter {
  execute(request: OpenClawWorkerRoleRequest): Promise<OpenClawWorkerRoleResult>;
}

export interface OpenClawRuntimeAdapter {
  listAvailableModels(): Promise<ModelResolution[]>;
  executePlanningRole(request: OpenClawPlanningRoleRequest): Promise<OpenClawPlanningRoleResult>;
  executeWorkerRole(request: OpenClawWorkerRoleRequest): Promise<OpenClawWorkerRoleResult>;
}

export interface CreateOpenClawPlanningRoleRequestInput {
  role: PlanningRoleName;
  request: PlanningRequest;
  resolvedMode: ResolvedPlanningMode;
  model: ModelResolution | string;
  prompt: OpenClawPromptReference;
  attempt?: number;
}

export interface CreateOpenClawWorkerRoleRequestInput {
  task: ExecutionNode;
  runtime: RuntimeState;
  repoPath: string;
  prompt: OpenClawPromptReference;
  role?: OpenClawWorkerRoleName;
  model?: ModelResolution | string;
  attempt?: number;
}

export interface CreateOpenClawRoleSuccessInput<TRequest, TOutput> {
  request: TRequest;
  summary: string;
  output: TOutput;
  session?: OpenClawAdapterSessionMetadata;
}

export interface CreateOpenClawRoleErrorInput<TRequest> {
  request: TRequest;
  code: OpenClawExecutionError['code'];
  message: string;
  retryable: boolean;
  details?: Record<string, string>;
}

export function createOpenClawPlanningRoleRequest(
  input: CreateOpenClawPlanningRoleRequestInput,
): OpenClawPlanningRoleRequest {
  return {
    envelope_version: 'openclaw.role-exec.v1',
    role_type: 'planning',
    role: input.role,
    model: normalizeModel(input.model),
    prompt: input.prompt,
    payload: {
      request: input.request.request,
      project_summary: input.request.project_summary,
      relevant_context: [...input.request.relevant_context],
      planning_mode: input.resolvedMode,
      constraints: [...input.request.constraints],
      existing_artifacts: [...(input.request.existing_artifacts ?? [])],
    },
    metadata: {
      attempt: input.attempt ?? 1,
      prompt_language: 'en',
    },
  };
}

export function createOpenClawWorkerRoleRequest(
  input: CreateOpenClawWorkerRoleRequestInput,
): OpenClawWorkerRoleRequest {
  return {
    envelope_version: 'openclaw.role-exec.v1',
    role_type: 'worker',
    role: input.role ?? input.task.assigned_agent,
    model: normalizeModel(input.model ?? input.task.model_metadata ?? input.task.model),
    prompt: input.prompt,
    payload: {
      repo_path: input.repoPath,
      task: {
        task_id: input.task.task_id,
        title: input.task.title,
        description: input.task.description,
        assigned_agent: input.task.assigned_agent,
        depends_on: [...input.task.depends_on],
        acceptance_criteria: [...input.task.acceptance_criteria],
        quality_gate: input.task.quality_gate,
        status: input.task.status,
      },
      runtime: {
        run_id: input.runtime.run_id,
        epic: input.runtime.epic,
        planning_mode: input.runtime.graph.planning_mode,
        retry_count: input.task.retry_count,
        max_retries: input.task.max_retries,
      },
      prior_error: input.task.error,
    },
    metadata: {
      run_id: input.runtime.run_id,
      task_id: input.task.task_id,
      attempt: input.attempt ?? input.task.retry_count + 1,
      prompt_language: 'en',
    },
  };
}

export function createOpenClawRoleSuccess<
  TOutput,
  TRole extends OpenClawRoleName,
  TRequest extends OpenClawRoleRequestEnvelope<unknown, TRole>,
>(
  input: CreateOpenClawRoleSuccessInput<TRequest, TOutput>,
): OpenClawRoleSuccessEnvelope<TOutput, TRole> {
  return {
    envelope_version: 'openclaw.role-exec.v1',
    ok: true,
    role_type: input.request.role_type,
    role: input.request.role,
    model: input.request.model,
    summary: input.summary,
    output: input.output,
    session: input.session,
  };
}

export function createOpenClawRoleError<
  TRole extends OpenClawRoleName,
  TRequest extends OpenClawRoleRequestEnvelope<unknown, TRole>,
>(
  input: CreateOpenClawRoleErrorInput<TRequest>,
): OpenClawRoleErrorEnvelope<TRole> {
  return {
    envelope_version: 'openclaw.role-exec.v1',
    ok: false,
    role_type: input.request.role_type,
    role: input.request.role,
    model: input.request.model,
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
      details: input.details,
    },
  };
}

export interface MockOpenClawRuntimeAdapterOptions {
  availableModels?: string[];
  executePlanningRole?: (
    request: OpenClawPlanningRoleRequest,
  ) => Promise<OpenClawPlanningRoleResult> | OpenClawPlanningRoleResult;
  executeWorkerRole?: (
    request: OpenClawWorkerRoleRequest,
  ) => Promise<OpenClawWorkerRoleResult> | OpenClawWorkerRoleResult;
}

export class MockOpenClawRuntimeAdapter implements OpenClawRuntimeAdapter {
  private readonly resolver = new OpenClawModelResolver();
  private readonly availableModels: string[];

  constructor(private readonly options: MockOpenClawRuntimeAdapterOptions = {}) {
    this.availableModels = options.availableModels ?? DEFAULT_OPENCLAW_AVAILABLE_MODELS;
  }

  async listAvailableModels(): Promise<ModelResolution[]> {
    return this.resolver.resolveAvailableModels(this.availableModels);
  }

  async executePlanningRole(request: OpenClawPlanningRoleRequest): Promise<OpenClawPlanningRoleResult> {
    if (this.options.executePlanningRole) {
      return await this.options.executePlanningRole(request);
    }

    return createOpenClawRoleSuccess({
      request,
      summary: `Prepared planning payload for ${request.role}.`,
      output: {
        accepted: true,
        payload_type: request.role_type,
        planning_mode: request.payload.planning_mode,
      },
      session: {
        adapter: 'mock-openclaw',
      },
    });
  }

  async executeWorkerRole(request: OpenClawWorkerRoleRequest): Promise<OpenClawWorkerRoleResult> {
    if (this.options.executeWorkerRole) {
      return await this.options.executeWorkerRole(request);
    }

    return createOpenClawRoleSuccess({
      request,
      summary: `Prepared worker payload for ${request.role}.`,
      output: {
        accepted: true,
        payload_type: request.role_type,
        task_id: request.payload.task.task_id,
      },
      session: {
        adapter: 'mock-openclaw',
      },
    });
  }
}

function normalizeModel(model: ModelResolution | string): ModelResolution {
  if (typeof model !== 'string') return model;
  return new OpenClawModelResolver().resolve(model);
}
