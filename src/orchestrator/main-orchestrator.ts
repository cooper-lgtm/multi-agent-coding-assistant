import type { PlanningRequest, PlanningResult } from '../schemas/planning.js';
import type { DagBuildResult, ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import { buildExecutionDag, findReadyTasks } from './dag-builder.js';

export interface ExecutionDispatchResult {
  taskId: string;
  status: 'implementation_done' | 'blocked' | 'failed';
  summary: string;
}

export interface OrchestratorDependencies {
  createPlan(request: PlanningRequest): Promise<PlanningResult>;
  dispatchImplementation(task: ExecutionNode, runtime: RuntimeState): Promise<ExecutionDispatchResult>;
}

export class MainOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async run(request: PlanningRequest): Promise<DagBuildResult> {
    const planningResult = await this.deps.createPlan(request);
    const dag = buildExecutionDag(planningResult);

    await this.executeLoop(dag.runtime);

    return {
      graph: dag.graph,
      runtime: dag.runtime,
      ready_tasks: findReadyTasks(dag.runtime),
    };
  }

  private async executeLoop(runtime: RuntimeState): Promise<void> {
    while (!this.areAllTasksTerminal(runtime)) {
      const readyTasks = findReadyTasks(runtime);
      if (readyTasks.length === 0) break;

      for (const task of readyTasks) {
        task.status = 'routed';
        const liveTask = runtime.tasks[task.task_id];
        liveTask.status = 'routed';

        const result = await this.deps.dispatchImplementation(liveTask, runtime);
        liveTask.result = result.summary;
        liveTask.status = result.status;
      }
    }
  }

  private areAllTasksTerminal(runtime: RuntimeState): boolean {
    return Object.values(runtime.tasks).every((task) =>
      ['completed', 'failed', 'cancelled'].includes(task.status),
    );
  }
}
