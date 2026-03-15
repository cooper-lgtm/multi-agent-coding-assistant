import type {
  ExecutionNode,
  RunFinalStatus,
  RunSummary,
  RunSummaryCounts,
  RuntimeEvent,
  RuntimeState,
  TaskRunSummary,
} from '../schemas/runtime.js';

export class ReportingManager {
  record(runtime: RuntimeState, type: string, message: string, taskId?: string): RuntimeEvent {
    const event: RuntimeEvent = {
      timestamp: new Date().toISOString(),
      task_id: taskId,
      type,
      message,
    };

    runtime.events.push(event);
    return event;
  }

  buildSummary(runtime: RuntimeState): RunSummary {
    const tasks = Object.values(runtime.tasks).map((task) => this.toTaskSummary(task));

    const counts = this.countStatuses(tasks);

    return {
      run_id: runtime.run_id,
      epic: runtime.epic,
      final_status: this.resolveFinalStatus(counts),
      counts,
      tasks,
      events: runtime.events.map((event) => event.message),
    };
  }

  private countStatuses(tasks: TaskRunSummary[]): RunSummaryCounts {
    const counts: RunSummaryCounts = {
      completed: 0,
      needs_fix: 0,
      blocked: 0,
      failed: 0,
      pending: 0,
    };

    for (const task of tasks) {
      switch (task.status) {
        case 'completed':
          counts.completed += 1;
          break;
        case 'needs_fix':
          counts.needs_fix += 1;
          break;
        case 'blocked':
          counts.blocked += 1;
          break;
        case 'failed':
          counts.failed += 1;
          break;
        default:
          counts.pending += 1;
          break;
      }
    }

    return counts;
  }

  private resolveFinalStatus(counts: RunSummaryCounts): RunFinalStatus {
    if (counts.failed > 0) return 'failed';
    if (counts.needs_fix > 0) return 'needs_fix';
    if (counts.blocked > 0) return 'blocked';
    if (counts.pending > 0) return 'running';
    return 'completed';
  }

  private toTaskSummary(task: ExecutionNode): TaskRunSummary {
    return {
      task_id: task.task_id,
      title: task.title,
      status: task.status,
      assigned_agent: task.assigned_agent,
      model: task.model,
      retry_count: task.retry_count,
      test_status: task.test_status,
      review_status: task.review_status,
    };
  }
}
