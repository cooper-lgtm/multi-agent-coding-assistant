import type {
  AssignedAgent,
  BudgetPolicy,
  PlanningRequest,
  RiskLevel,
  RoleFallbackPolicy,
} from '../schemas/planning.js';
import type { ExecutionNode, RuntimePolicyState, RuntimeState } from '../schemas/runtime.js';
import { findReadyTasks } from './dag-builder.js';

const RISK_PRIORITY: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface PolicyEngineOptions {
  defaultMaxParallelTasks?: number | null;
  defaultMaxRetriesPerTask?: number;
  defaultRiskEscalationThreshold?: RiskLevel | null;
  defaultRoleFallbackPolicy?: RoleFallbackPolicy;
}

export class PolicyEngine {
  private readonly defaultMaxParallelTasks: number | null;
  private readonly defaultMaxRetriesPerTask: number;
  private readonly defaultRiskEscalationThreshold: RiskLevel | null;
  private readonly defaultRoleFallbackPolicy: RoleFallbackPolicy;

  constructor(options: PolicyEngineOptions = {}) {
    this.defaultMaxParallelTasks = this.normalizeOptionalPositiveInt(options.defaultMaxParallelTasks) ?? null;
    this.defaultMaxRetriesPerTask = this.normalizeNonNegativeInt(options.defaultMaxRetriesPerTask, 2);
    this.defaultRiskEscalationThreshold = options.defaultRiskEscalationThreshold ?? null;
    this.defaultRoleFallbackPolicy = this.cloneFallbackPolicy(options.defaultRoleFallbackPolicy);
  }

  applyToRuntime(
    runtime: RuntimeState,
    request: Pick<PlanningRequest, 'budget_policy'>,
  ): RuntimePolicyState {
    const policy = this.resolvePolicyState(request.budget_policy);
    runtime.policy_state = this.clonePolicyState(policy);

    for (const task of Object.values(runtime.tasks)) {
      task.max_retries = this.resolveTaskRetryBudget(task, policy);
      task.fallback_models = this.resolveFallbackModels(task, policy);

      if (task.status === 'pending' && this.requiresManualReview(task, policy)) {
        const message = this.buildRiskEscalationMessage(task, policy.risk_escalation_threshold!);
        task.status = 'blocked';
        task.blocker_category = task.blocker_category ?? 'unknown';
        task.blocker_message = message;
        task.error = message;

        if (!task.risk_notes.includes(message)) {
          task.risk_notes = [...task.risk_notes, message];
        }
      }
    }

    return this.clonePolicyState(policy);
  }

  selectDispatchableTasks(runtime: RuntimeState): ExecutionNode[] {
    const readyTasks = findReadyTasks(runtime);
    const limit = runtime.policy_state?.max_parallel_tasks ?? null;

    if (limit === null) {
      return readyTasks;
    }

    return readyTasks.slice(0, limit);
  }

  private resolvePolicyState(budgetPolicy?: BudgetPolicy): RuntimePolicyState {
    const taskRetryBudgets = Object.fromEntries(
      Object.entries(budgetPolicy?.taskRetryBudgets ?? {})
        .map(([taskId, retryBudget]) => [taskId, this.normalizeNonNegativeInt(retryBudget, 0)])
        .filter(([, retryBudget]) => retryBudget !== null),
    ) as Record<string, number>;

    return {
      max_parallel_tasks:
        this.normalizeOptionalPositiveInt(budgetPolicy?.maxParallelTasks) ?? this.defaultMaxParallelTasks,
      max_retries_per_task: this.normalizeNonNegativeInt(
        budgetPolicy?.maxRetriesPerTask,
        this.defaultMaxRetriesPerTask,
      ),
      task_retry_budgets: taskRetryBudgets,
      risk_escalation_threshold: budgetPolicy?.riskEscalationThreshold ?? this.defaultRiskEscalationThreshold,
      role_fallback_policy: this.cloneFallbackPolicy(
        budgetPolicy?.roleFallbackPolicy ?? this.defaultRoleFallbackPolicy,
      ),
    };
  }

  private resolveTaskRetryBudget(task: ExecutionNode, policy: RuntimePolicyState): number {
    return policy.task_retry_budgets[task.task_id] ?? policy.max_retries_per_task;
  }

  private resolveFallbackModels(task: ExecutionNode, policy: RuntimePolicyState): string[] {
    return [...(policy.role_fallback_policy[task.assigned_agent] ?? [])];
  }

  private requiresManualReview(task: ExecutionNode, threshold: Pick<RuntimePolicyState, 'risk_escalation_threshold'>): boolean {
    if (!threshold.risk_escalation_threshold) {
      return false;
    }

    return RISK_PRIORITY[task.risk] >= RISK_PRIORITY[threshold.risk_escalation_threshold];
  }

  private buildRiskEscalationMessage(task: ExecutionNode, threshold: RiskLevel): string {
    return `Task ${task.task_id} meets the ${threshold} risk threshold and requires manual review before execution.`;
  }

  private clonePolicyState(policy: RuntimePolicyState): RuntimePolicyState {
    return {
      max_parallel_tasks: policy.max_parallel_tasks,
      max_retries_per_task: policy.max_retries_per_task,
      task_retry_budgets: { ...policy.task_retry_budgets },
      risk_escalation_threshold: policy.risk_escalation_threshold,
      role_fallback_policy: this.cloneFallbackPolicy(policy.role_fallback_policy),
    };
  }

  private cloneFallbackPolicy(policy: RoleFallbackPolicy | undefined): RoleFallbackPolicy {
    const cloned: Partial<Record<AssignedAgent, string[]>> = {};

    for (const [role, models] of Object.entries(policy ?? {})) {
      if (!models?.length) continue;
      cloned[role as AssignedAgent] = [...models];
    }

    return cloned;
  }

  private normalizeOptionalPositiveInt(value: number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (!Number.isFinite(value)) {
      return null;
    }

    return Math.max(1, Math.floor(value));
  }

  private normalizeNonNegativeInt(value: number | null | undefined, fallback: number): number {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(0, Math.floor(value));
  }
}
