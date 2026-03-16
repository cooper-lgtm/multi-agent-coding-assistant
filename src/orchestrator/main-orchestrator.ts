import type { PlanningRequest, PlanningResult } from '../schemas/planning.js';
import type { RuntimeTaskStatus } from '../schemas/planning.js';
import type { ExecutionNode, OrchestrationRunResult, RuntimeState } from '../schemas/runtime.js';
import { buildExecutionDag, findReadyTasks } from './dag-builder.js';
import type { ImplementationDispatcher } from './implementation-dispatcher.js';
import type { QualityGateRunner } from './quality-gate-runner.js';
import type { RetryCause, RetryDecision, RetryManager } from './retry-escalation-manager.js';
import { ReportingManager } from './reporting-manager.js';
import type { RunStore } from '../storage/run-store.js';
import {
  applyWorkerExecutionContext,
  createWorkerRetryHandoff,
} from '../workers/contracts.js';

export interface OrchestratorDependencies {
  createPlan(request: PlanningRequest): Promise<PlanningResult>;
  implementationDispatcher: ImplementationDispatcher;
  qualityGateRunner: QualityGateRunner;
  retryManager: RetryManager;
  reportingManager: ReportingManager;
  runStore: RunStore;
}

export class MainOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async run(request: PlanningRequest): Promise<OrchestrationRunResult> {
    const planningResult = await this.deps.createPlan(request);
    const dag = buildExecutionDag(planningResult, {
      maxRetriesPerTask: request.budget_policy?.maxRetriesPerTask,
    });
    const runtime = dag.runtime;

    this.deps.reportingManager.record(
      runtime,
      'orchestrator_started',
      `Starting orchestration run ${runtime.run_id} for epic ${runtime.epic}.`,
    );
    await this.persist(runtime);
    await this.executeLoop(runtime);
    await this.persist(runtime);

    return {
      graph: dag.graph,
      runtime,
      ready_tasks: findReadyTasks(runtime),
      summary: this.deps.reportingManager.buildSummary(runtime),
    };
  }

  private async executeLoop(runtime: RuntimeState): Promise<void> {
    while (!this.areAllTasksTerminal(runtime)) {
      this.blockTasksWithFailedDependencies(runtime);
      if (this.areAllTasksTerminal(runtime)) break;

      const readyTasks = findReadyTasks(runtime);
      if (readyTasks.length === 0) {
        this.deps.reportingManager.record(
          runtime,
          'orchestrator_stalled',
          `No ready tasks remain for run ${runtime.run_id}.`,
        );
        break;
      }

      for (const task of readyTasks) {
        const liveTask = runtime.tasks[task.task_id];
        await this.executeTask(liveTask, runtime);
        this.blockTasksWithFailedDependencies(runtime);
      }
    }
  }

  private async executeTask(task: ExecutionNode, runtime: RuntimeState): Promise<void> {
    task.status = 'routed';
    this.deps.reportingManager.record(
      runtime,
      'task_routed',
      `Dispatching ${task.task_id} to ${task.assigned_agent} on ${task.model}.`,
      task.task_id,
    );
    await this.persist(runtime);

    task.status = 'running';
    await this.persist(runtime);

    const dispatchResult = await this.deps.implementationDispatcher.dispatch(task, runtime);
    task.result = dispatchResult.summary;
    applyWorkerExecutionContext(task, dispatchResult);

    if (dispatchResult.status === 'implementation_done') {
      task.error = null;
      task.status = 'implementation_done';
      this.deps.reportingManager.record(
        runtime,
        'implementation_completed',
        `Implementation completed for ${task.task_id}.`,
        task.task_id,
      );
      await this.persist(runtime);
      await this.runQualityGates(task, runtime);
      return;
    }

    task.status = dispatchResult.status === 'blocked' ? 'blocked' : 'failed';
    task.error = dispatchResult.blocker_message ?? dispatchResult.summary;
    const failureCause: RetryCause =
      dispatchResult.status === 'blocked' ? 'implementation_blocked' : 'implementation_failed';
    const decision = this.deps.retryManager.decide(task, failureCause);
    this.applyRetryDecision(task, decision, runtime);
    await this.persist(runtime);
  }

  private async runQualityGates(task: ExecutionNode, runtime: RuntimeState): Promise<void> {
    task.status = 'testing';
    this.deps.reportingManager.record(
      runtime,
      'quality_gate_started',
      `Running quality gates for ${task.task_id}.`,
      task.task_id,
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
      );
    }
    if (gateResult.review_model) {
      this.deps.reportingManager.record(
        runtime,
        'review_gate_routed',
        `Review gate for ${task.task_id} ran on ${gateResult.review_model}.`,
        task.task_id,
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
      );
      await this.persist(runtime);
      return;
    }

    task.status = gateResult.status === 'needs_fix' ? 'needs_fix' : 'failed';
    task.error = gateResult.blocker_message ?? gateResult.summary;
    const failureCause: RetryCause =
      gateResult.status === 'needs_fix' ? 'quality_needs_fix' : 'quality_failed';
    const decision = this.deps.retryManager.decide(task, failureCause);
    this.applyRetryDecision(task, decision, runtime);
    await this.persist(runtime);
  }

  private applyRetryDecision(task: ExecutionNode, decision: RetryDecision, runtime: RuntimeState): void {
    const attemptStatus = task.status === 'needs_fix' ? 'needs_fix' : task.status === 'blocked' ? 'blocked' : 'failed';

    task.retry_count = decision.retry_count;

    if (decision.action === 'retry_same_model' || decision.action === 'retry_with_upgraded_model') {
      task.prior_attempt = createWorkerRetryHandoff(
        task,
        task.retry_count,
        attemptStatus,
        task.result ?? task.error ?? `Attempt ${task.retry_count} finished without a summary.`,
      );
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
      );
      return;
    }

    task.status = decision.next_status;
    this.deps.reportingManager.record(
      runtime,
      'task_terminal_negative',
      decision.reason,
      task.task_id,
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
        );
        hasChanges = true;
      }
    }
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

  private async persist(runtime: RuntimeState): Promise<void> {
    runtime.graph.nodes = structuredClone(runtime.tasks);
    await this.deps.runStore.save(runtime);
  }
}
