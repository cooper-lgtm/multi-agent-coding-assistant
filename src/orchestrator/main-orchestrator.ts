import type { PlanningRequest, PlanningResult, RuntimeTaskStatus } from '../schemas/planning.js';
import {
  createRuntimeEventModelSelection,
  type ExecutionNode,
  type OrchestrationRunResult,
  type RunLifecycleStatus,
  type RuntimeState,
} from '../schemas/runtime.js';
import { buildExecutionDag, findReadyTasks } from './dag-builder.js';
import type { ImplementationDispatcher } from './implementation-dispatcher.js';
import type { QualityGateRunner } from './quality-gate-runner.js';
import type { RetryCause, RetryDecision, RetryManager } from './retry-escalation-manager.js';
import { ReportingManager } from './reporting-manager.js';
import type { RunStore } from '../storage/run-store.js';
import { ApprovalManager } from './approval-manager.js';
import { PolicyEngine } from './policy-engine.js';
import {
  createRuntimeMiddlewareRunner,
  type RuntimeMiddleware,
  type RuntimeMiddlewareRunner,
} from './runtime-middleware.js';
import { createPreCompletionChecklistMiddleware } from './pre-completion-checklist-middleware.js';
import { createLoopDetectionMiddleware } from './loop-detection-middleware.js';
import {
  applyWorkerExecutionContext,
  createWorkerRetryHandoff,
  getWorkerAttemptNumber,
  recordWorkerRetryHandoff,
  type WorkerFailureCategory,
} from '../workers/contracts.js';

export interface OrchestratorDependencies {
  createPlan(request: PlanningRequest): Promise<PlanningResult>;
  implementationDispatcher: ImplementationDispatcher;
  qualityGateRunner: QualityGateRunner;
  retryManager: RetryManager;
  reportingManager: ReportingManager;
  runStore: RunStore;
  approvalManager?: ApprovalManager;
  policyEngine?: PolicyEngine;
  runtimeMiddleware?: RuntimeMiddleware[];
}

export class MainOrchestrator {
  private readonly approvalManager: ApprovalManager;
  private readonly policyEngine: PolicyEngine;
  private readonly runtimeMiddleware: RuntimeMiddlewareRunner;

  constructor(private readonly deps: OrchestratorDependencies) {
    this.approvalManager = deps.approvalManager ?? new ApprovalManager();
    this.policyEngine = deps.policyEngine ?? new PolicyEngine();
    this.runtimeMiddleware = createRuntimeMiddlewareRunner([
      createPreCompletionChecklistMiddleware(),
      createLoopDetectionMiddleware(),
      ...(deps.runtimeMiddleware ?? []),
    ]);
  }

  async run(request: PlanningRequest): Promise<OrchestrationRunResult> {
    const planningResult = await this.deps.createPlan(request);
    const dag = buildExecutionDag(planningResult, {
      maxRetriesPerTask: request.budget_policy?.maxRetriesPerTask,
    });
    const runtime = dag.runtime;

    const policyState = this.policyEngine.applyToRuntime(runtime, request);
    runtime.approval_state = this.approvalManager.initialize(runtime, request);
    runtime.status = 'running';
    this.deps.reportingManager.record(
      runtime,
      'orchestrator_started',
      `Starting orchestration run ${runtime.run_id} for epic ${runtime.epic}.`,
    );
    this.deps.reportingManager.record(
      runtime,
      'policy_applied',
      this.buildPolicyMessage(policyState),
    );
    this.recordPolicyBlocks(runtime);

    if (!this.approvalManager.canExecute(runtime)) {
      this.approvalManager.markAwaitingApproval(runtime);
      this.deps.reportingManager.record(
        runtime,
        'awaiting_human_approval',
        `Run ${runtime.run_id} is waiting for explicit approval before execution.`,
        undefined,
        {
          metadata: {
            approval_mode: runtime.approval_state?.mode ?? 'confirm-before-run',
          },
        },
      );
      await this.persist(runtime);
      await this.finalize(runtime);
      return this.buildResult(runtime);
    }

    await this.persist(runtime);
    await this.executeLoop(runtime);
    await this.finalize(runtime);

    return this.buildResult(runtime);
  }

  async resume(runId: string): Promise<OrchestrationRunResult> {
    const runtime = await this.deps.runStore.load(runId);

    if (!runtime) {
      throw new Error(`Unknown run: ${runId}`);
    }

    if (this.isRunFinished(runtime.status)) {
      return this.buildResult(runtime);
    }

    runtime.control = {
      pause_requested: false,
      cancel_requested: runtime.control.cancel_requested,
    };

    if (await this.handleControlRequests(runtime)) {
      await this.finalize(runtime);
      return this.buildResult(runtime);
    }

    if (!this.approvalManager.canExecute(runtime)) {
      this.approvalManager.markAwaitingApproval(runtime);
      this.deps.reportingManager.record(
        runtime,
        'awaiting_human_approval',
        `Run ${runtime.run_id} is still waiting for approval before execution can resume.`,
        undefined,
        {
          metadata: {
            approval_mode: runtime.approval_state?.mode ?? 'confirm-before-run',
          },
        },
      );
      await this.persist(runtime, { syncControl: false });
      await this.finalize(runtime);
      return this.buildResult(runtime);
    }

    this.prepareRuntimeForResume(runtime);
    this.deps.reportingManager.record(
      runtime,
      'orchestrator_resumed',
      `Resuming orchestration run ${runtime.run_id}.`,
    );
    await this.persist(runtime, { syncControl: false });
    await this.executeLoop(runtime);
    await this.finalize(runtime);

    return this.buildResult(runtime);
  }

  private async executeLoop(runtime: RuntimeState): Promise<void> {
    while (!this.areAllTasksTerminal(runtime)) {
      await this.syncControlFromStore(runtime);
      if (await this.handleControlRequests(runtime)) return;

      this.blockTasksWithFailedDependencies(runtime);
      if (this.areAllTasksTerminal(runtime)) break;

      const checkpointTasks = this.findImplementationCheckpointTasks(runtime);
      if (checkpointTasks.length > 0) {
        for (const task of checkpointTasks) {
          await this.syncControlFromStore(runtime);
          if (await this.handleControlRequests(runtime)) return;

          await this.runQualityGates(runtime.tasks[task.task_id], runtime);
          this.blockTasksWithFailedDependencies(runtime);
        }

        continue;
      }

      const readyTasks = this.policyEngine.selectDispatchableTasks(runtime);
      if (readyTasks.length === 0) {
        this.deps.reportingManager.record(
          runtime,
          'orchestrator_stalled',
          `No ready tasks remain for run ${runtime.run_id}.`,
        );
        break;
      }

      for (const task of readyTasks) {
        await this.syncControlFromStore(runtime);
        if (await this.handleControlRequests(runtime)) return;

        const liveTask = runtime.tasks[task.task_id];
        await this.executeTask(liveTask, runtime);
        this.blockTasksWithFailedDependencies(runtime);
      }
    }
  }

  private buildPolicyMessage(policyState: NonNullable<RuntimeState['policy_state']>): string {
    const parallelism = policyState.max_parallel_tasks === null
      ? 'unbounded ready-task dispatch'
      : `max parallel dispatch ${policyState.max_parallel_tasks}`;
    const riskThreshold = policyState.risk_escalation_threshold ?? 'none';

    return `Applied runtime policy: ${parallelism}, default retry budget ${policyState.max_retries_per_task}, risk threshold ${riskThreshold}.`;
  }

  private recordPolicyBlocks(runtime: RuntimeState): void {
    for (const task of Object.values(runtime.tasks)) {
      if (task.status !== 'blocked') {
        continue;
      }

      if (!task.blocker_message?.includes('manual review')) {
        continue;
      }

      this.deps.reportingManager.record(
        runtime,
        'task_blocked_by_policy',
        task.blocker_message,
        task.task_id,
        {
          failureCategory: 'policy',
          metadata: {
            assigned_agent: task.assigned_agent,
          },
        },
      );
    }
  }

  private async executeTask(task: ExecutionNode, runtime: RuntimeState): Promise<void> {
    await this.runtimeMiddleware.beforeDispatch(task, runtime);
    task.status = 'routed';
    this.deps.reportingManager.record(
      runtime,
      'task_routed',
      `Dispatching ${task.task_id} to ${task.assigned_agent} on ${task.model}.`,
      task.task_id,
      {
        metadata: {
          assigned_agent: task.assigned_agent,
        },
      },
    );
    await this.persist(runtime);

    task.status = 'running';
    await this.persist(runtime);

    const dispatchResult = await this.deps.implementationDispatcher.dispatch(task, runtime);
    task.result = dispatchResult.summary;
    applyWorkerExecutionContext(task, dispatchResult);
    await this.runtimeMiddleware.afterImplementationAttempt(task, runtime, dispatchResult);

    if (dispatchResult.status === 'implementation_done') {
      task.error = null;
      task.status = 'implementation_done';
      this.deps.reportingManager.record(
        runtime,
        'implementation_completed',
        `Implementation completed for ${task.task_id}.`,
        task.task_id,
        {
          metadata: {
            changed_files: task.changed_files,
          },
        },
      );
      await this.persist(runtime);
      return;
    }

    task.status = dispatchResult.status === 'blocked' ? 'blocked' : 'failed';
    task.error = dispatchResult.blocker_message ?? dispatchResult.summary;
    const failureCause: RetryCause =
      dispatchResult.status === 'blocked' ? 'implementation_blocked' : 'implementation_failed';
    this.annotateFailureContext(task, failureCause, task.error ?? dispatchResult.summary);
    const decision = this.decideRetry(task, runtime, failureCause);
    this.applyRetryDecision(task, decision, runtime);
    await this.persist(runtime);
  }

  private async runQualityGates(task: ExecutionNode, runtime: RuntimeState): Promise<void> {
    const middlewareDecision = await this.runtimeMiddleware.beforeQualityGates(task, runtime);

    if (middlewareDecision) {
      const continuationCount = this.countRuntimeMiddlewareContinuations(runtime, task.task_id);
      const middlewareName = this.formatMiddlewareName(middlewareDecision.middlewareName);

      if (task.retry_count + continuationCount >= task.max_retries) {
        const message = `Runtime middleware ${middlewareName} exhausted the continuation budget for ${task.task_id}.`;
        task.status = 'failed';
        task.error = message;
        task.blocker_category = 'quality';
        task.blocker_message = message;
        this.deps.reportingManager.record(
          runtime,
          'runtime_middleware_continuation_exhausted',
          message,
          task.task_id,
        );
        await this.persist(runtime);
        return;
      }

      task.blocker_category = 'quality';
      task.blocker_message = middlewareDecision.message;
      task.error = middlewareDecision.message;
      this.annotateFailureContext(task, 'verification_incomplete', middlewareDecision.message);
      recordWorkerRetryHandoff(task, createWorkerRetryHandoff(
        task,
        getWorkerAttemptNumber(task),
        'needs_fix',
        middlewareDecision.message,
      ));
      task.status = 'pending';
      task.test_status = 'pending';
      task.review_status = 'pending';
      this.deps.reportingManager.record(
        runtime,
        'runtime_middleware_requested_continuation',
        `Runtime middleware ${middlewareName} requested task continuation for ${task.task_id}: ${middlewareDecision.message}`,
        task.task_id,
      );
      await this.persist(runtime);
      return;
    }

    task.status = 'testing';
    task.test_status = 'pending';
    task.review_status = 'pending';
    this.deps.reportingManager.record(
      runtime,
      'quality_gate_started',
      `Running quality gates for ${task.task_id}.`,
      task.task_id,
      {
        metadata: {
          roles: ['test-agent', 'review-agent'],
        },
      },
    );
    await this.persist(runtime);

    const gateResult = await this.deps.qualityGateRunner.run(task, runtime);
    task.result = gateResult.summary;
    task.test_status = gateResult.test_status;
    task.review_status = gateResult.review_status;
    applyWorkerExecutionContext(task, gateResult);

    if (gateResult.test_model) {
      this.deps.reportingManager.record(
        runtime,
        'test_gate_routed',
        `Test gate for ${task.task_id} ran on ${gateResult.test_model}.`,
        task.task_id,
        {
          model: createRuntimeEventModelSelection(gateResult.test_model),
          metadata: {
            gate: 'test-agent',
          },
        },
      );
    }
    if (gateResult.review_model) {
      this.deps.reportingManager.record(
        runtime,
        'review_gate_routed',
        `Review gate for ${task.task_id} ran on ${gateResult.review_model}.`,
        task.task_id,
        {
          model: createRuntimeEventModelSelection(gateResult.review_model),
          metadata: {
            gate: 'review-agent',
          },
        },
      );
    }

    if (gateResult.status === 'completed') {
      task.status = 'completed';
      task.error = null;
      this.deps.reportingManager.record(
        runtime,
        'task_completed',
        `Task ${task.task_id} completed after quality gates.`,
        task.task_id,
        {
          metadata: {
            changed_files: task.changed_files,
          },
        },
      );
      await this.persist(runtime);
      return;
    }

    task.status = gateResult.status === 'needs_fix' ? 'needs_fix' : 'failed';
    task.error = gateResult.blocker_message ?? gateResult.summary;
    const failureCause: RetryCause =
      gateResult.status === 'needs_fix' ? 'quality_needs_fix' : 'quality_failed';
    this.annotateFailureContext(task, failureCause, task.error ?? gateResult.summary);
    const decision = this.decideRetry(task, runtime, failureCause);
    this.applyRetryDecision(task, decision, runtime);
    await this.persist(runtime);
  }

  private applyRetryDecision(task: ExecutionNode, decision: RetryDecision, runtime: RuntimeState): void {
    const attemptStatus =
      task.status === 'needs_fix' ? 'needs_fix' : task.status === 'blocked' ? 'blocked' : 'failed';
    const completedAttempt = getWorkerAttemptNumber(task);

    task.retry_count = decision.retry_count;

    if (decision.action === 'retry_same_model' || decision.action === 'retry_with_upgraded_model') {
      recordWorkerRetryHandoff(task, createWorkerRetryHandoff(
        task,
        completedAttempt,
        attemptStatus,
        task.result ?? task.error ?? `Attempt ${task.retry_count} finished without a summary.`,
      ));
      task.status = 'pending';
      task.model = decision.next_model;
      task.model_metadata = decision.next_model_metadata;
      task.test_status = 'pending';
      task.review_status = 'pending';
      this.deps.reportingManager.record(
        runtime,
        'retry_scheduled',
        `${this.formatRetryMessage(task, decision)}`,
        task.task_id,
        {
          failureCategory: decision.cause,
          metadata: {
            retry_action: decision.action,
            next_model: decision.next_model,
          },
        },
      );
      return;
    }

    task.status = decision.next_status;
    this.deps.reportingManager.record(
      runtime,
      'task_terminal_negative',
      decision.reason,
      task.task_id,
      {
        failureCategory: decision.cause,
        metadata: {
          terminal_status: decision.next_status,
        },
      },
    );
  }

  private formatRetryMessage(task: ExecutionNode, decision: RetryDecision): string {
    if (decision.action === 'retry_with_upgraded_model') {
      return `Retry escalation for ${task.task_id}: retry ${decision.retry_count} will use ${decision.next_model}.`;
    }

    return `Retry scheduled for ${task.task_id}: retry ${decision.retry_count} will reuse ${decision.next_model}.`;
  }

  private blockTasksWithFailedDependencies(runtime: RuntimeState): void {
    let hasChanges = true;

    while (hasChanges) {
      hasChanges = false;

      for (const task of Object.values(runtime.tasks)) {
        if (this.isTerminal(task.status)) continue;

        const blockingDependency = task.depends_on.find((dependencyId) =>
          this.isNegativeTerminal(runtime.tasks[dependencyId]?.status),
        );

        if (!blockingDependency) continue;

        task.status = 'blocked';
        task.blocker_category = 'dependency';
        task.blocker_message = `Dependency ${blockingDependency} is not recoverable.`;
        task.error = task.blocker_message;
        this.deps.reportingManager.record(
          runtime,
          'task_blocked_by_dependency',
          `Task ${task.task_id} is blocked by dependency ${blockingDependency}.`,
          task.task_id,
          {
            failureCategory: 'dependency',
            metadata: {
              blocking_dependency: blockingDependency,
            },
          },
        );
        hasChanges = true;
      }
    }
  }

  private prepareRuntimeForResume(runtime: RuntimeState): void {
    runtime.status = 'running';
    runtime.control = {
      pause_requested: false,
      cancel_requested: runtime.control.cancel_requested,
    };

    for (const task of Object.values(runtime.tasks)) {
      switch (task.status) {
        case 'routed':
        case 'running':
          task.status = 'pending';
          task.error = null;
          task.test_status = 'pending';
          task.review_status = 'pending';
          break;
        case 'testing':
        case 'reviewing':
          task.status = 'implementation_done';
          task.test_status = 'pending';
          task.review_status = 'pending';
          break;
        default:
          break;
      }
    }
  }

  private findImplementationCheckpointTasks(runtime: RuntimeState): ExecutionNode[] {
    return Object.values(runtime.tasks).filter((task) => task.status === 'implementation_done');
  }

  private countRuntimeMiddlewareContinuations(runtime: RuntimeState, taskId: string): number {
    return runtime.events.filter((event) =>
      event.task_id === taskId && event.type === 'runtime_middleware_requested_continuation',
    ).length;
  }

  private formatMiddlewareName(name: string): string {
    if (name === 'pre-completion-checklist') {
      return 'pre-completion checklist';
    }

    return name.replaceAll('-', ' ');
  }

  private decideRetry(task: ExecutionNode, runtime: RuntimeState, cause: RetryCause): RetryDecision {
    if (cause === 'implementation_blocked') {
      return this.deps.retryManager.decide(task, cause);
    }

    const continuationCount = this.countRuntimeMiddlewareContinuations(runtime, task.task_id);
    const consumedExtraAttempts = task.retry_count + continuationCount;

    if (consumedExtraAttempts >= task.max_retries) {
      const nextStatus = this.toTerminalStatus(cause);

      return {
        taskId: task.task_id,
        cause,
        action: 'keep_terminal_status',
        next_status: nextStatus,
        next_model: task.model,
        next_model_metadata: task.model_metadata,
        retry_count: task.retry_count,
        reason: `Retry budget exhausted for ${task.task_id}; keeping ${nextStatus}.`,
      };
    }

    return this.deps.retryManager.decide(task, cause);
  }

  private annotateFailureContext(
    task: ExecutionNode,
    failureCategory: WorkerFailureCategory,
    summary: string,
  ): void {
    task.failure_category = failureCategory;
    const fallbackDiagnosis = this.buildFailureDiagnosis(task, failureCategory, summary);

    if (!this.hasSpecificFailureDiagnosis(task.failure_diagnosis, summary, task.blocker_message)) {
      task.failure_diagnosis = fallbackDiagnosis;
    }

    if (task.reconsider_instructions.length === 0) {
      task.reconsider_instructions = this.buildReconsiderInstructions(task, failureCategory);
    }
  }

  private buildFailureDiagnosis(
    task: ExecutionNode,
    failureCategory: WorkerFailureCategory,
    summary: string,
  ): string {
    switch (failureCategory) {
      case 'verification_incomplete':
        if (task.checklist_feedback.length > 0) {
          return `Verification evidence is still incomplete: ${task.checklist_feedback.join(' ')}`;
        }
        return summary;
      case 'quality_needs_fix':
        if (task.review_feedback.length > 0) {
          return `External quality feedback still requires changes: ${task.review_feedback.join(' ')}`;
        }
        return summary;
      case 'quality_failed':
        return `Quality gates failed: ${summary}`;
      case 'implementation_blocked':
        return task.blocker_message ?? summary;
      case 'implementation_failed':
        if (!task.blocker_message || task.blocker_message === summary) {
          return summary;
        }
        return `${summary} ${task.blocker_message}`;
      default:
        return summary;
    }
  }

  private hasSpecificFailureDiagnosis(
    diagnosis: string | null,
    summary: string,
    blockerMessage: string | null,
  ): boolean {
    if (!diagnosis) {
      return false;
    }

    if (diagnosis === summary) {
      return false;
    }

    if (blockerMessage && diagnosis === blockerMessage) {
      return false;
    }

    if (blockerMessage && diagnosis === `${summary} ${blockerMessage}`) {
      return false;
    }

    return true;
  }

  private buildReconsiderInstructions(
    task: ExecutionNode,
    failureCategory: WorkerFailureCategory,
  ): string[] {
    if (failureCategory === 'verification_incomplete') {
      return task.checklist_feedback.length > 0
        ? [
            'Run the missing verification commands before handing work to external quality gates.',
            ...task.checklist_feedback,
          ]
        : ['Re-run the required verification loop and attach explicit evidence.'];
    }

    if (failureCategory === 'quality_needs_fix') {
      return task.review_feedback.length > 0
        ? [
            'Read the latest review feedback before editing again.',
            ...task.review_feedback,
          ]
        : ['Inspect the latest quality-gate result before retrying the same task.'];
    }

    if (failureCategory === 'implementation_blocked') {
      return ['Resolve the blocking prerequisite before retrying implementation.'];
    }

    return ['Inspect the latest failure evidence before retrying the same task.'];
  }

  private async syncControlFromStore(runtime: RuntimeState): Promise<void> {
    const manifest = await this.deps.runStore.loadManifest(runtime.run_id);

    if (!manifest) {
      return;
    }

    runtime.control = {
      ...manifest.control,
    };
  }

  private async handleControlRequests(runtime: RuntimeState): Promise<boolean> {
    if (runtime.control.cancel_requested) {
      this.deps.reportingManager.record(
        runtime,
        'cancel_requested',
        `Cancellation requested for run ${runtime.run_id}.`,
      );
      this.cancelPendingWork(runtime);
      runtime.status = 'cancelled';
      this.deps.reportingManager.record(
        runtime,
        'run_cancelled',
        `Run ${runtime.run_id} stopped at a safe checkpoint after cancellation.`,
      );
      await this.persist(runtime, { syncControl: false });
      return true;
    }

    if (runtime.control.pause_requested) {
      this.deps.reportingManager.record(
        runtime,
        'pause_requested',
        `Pause requested for run ${runtime.run_id}.`,
      );
      runtime.status = 'paused';
      this.deps.reportingManager.record(
        runtime,
        'run_paused',
        `Run ${runtime.run_id} paused at a safe checkpoint.`,
      );
      await this.persist(runtime, { syncControl: false });
      return true;
    }

    return false;
  }

  private cancelPendingWork(runtime: RuntimeState): void {
    for (const task of Object.values(runtime.tasks)) {
      if (this.isTerminal(task.status) || task.status === 'implementation_done') {
        continue;
      }

      task.status = 'cancelled';
      task.error = task.error ?? 'Run cancelled before the task reached a terminal state.';
    }
  }

  private async finalize(runtime: RuntimeState): Promise<void> {
    if (runtime.status === 'paused') {
      await this.persist(runtime);
      return;
    }

    if (!this.isRunFinished(runtime.status)) {
      runtime.status = this.resolveRunStatus(runtime);
    }

    await this.persist(runtime);
  }

  private resolveRunStatus(runtime: RuntimeState): RunLifecycleStatus {
    const statuses = Object.values(runtime.tasks).map((task) => task.status);

    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('needs_fix')) return 'needs_fix';
    if (statuses.includes('blocked')) return 'blocked';
    if (statuses.includes('cancelled')) return 'cancelled';
    if (statuses.every((status) => status === 'completed')) return 'completed';
    return 'running';
  }

  private buildResult(runtime: RuntimeState): OrchestrationRunResult {
    return {
      graph: runtime.graph,
      runtime,
      ready_tasks: findReadyTasks(runtime),
      summary: this.deps.reportingManager.buildSummary(runtime),
    };
  }

  private areAllTasksTerminal(runtime: RuntimeState): boolean {
    return Object.values(runtime.tasks).every((task) => this.isTerminal(task.status));
  }

  private isTerminal(status: RuntimeTaskStatus): boolean {
    return ['completed', 'needs_fix', 'blocked', 'failed', 'cancelled'].includes(status);
  }

  private isNegativeTerminal(status: RuntimeTaskStatus | undefined): boolean {
    return status === 'needs_fix' || status === 'blocked' || status === 'failed' || status === 'cancelled';
  }

  private isRunFinished(status: RunLifecycleStatus): boolean {
    return ['completed', 'needs_fix', 'blocked', 'failed', 'cancelled'].includes(status);
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

  private async persist(runtime: RuntimeState, options: { syncControl?: boolean } = {}): Promise<void> {
    if (options.syncControl !== false) {
      await this.syncControlFromStore(runtime);
    }

    runtime.graph.nodes = structuredClone(runtime.tasks);
    runtime.updated_at = new Date().toISOString();
    await this.deps.runStore.save(runtime);
  }
}
