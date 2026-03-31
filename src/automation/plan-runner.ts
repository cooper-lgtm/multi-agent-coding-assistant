export type PlanTaskExecutionStatus = 'completed' | 'blocked' | 'failed';
export type PlanTaskMergeStatus = 'merged' | 'opened_not_merged' | 'not_opened';
export type RequiredCheckStatus = 'pending' | 'pass' | 'fail' | 'cancelled' | 'timed_out';
export type PlanRunnerPendingGate = 'required_checks';

export interface ExecutedTaskSlice {
  status: PlanTaskExecutionStatus;
  selected_task: string;
  branch_name?: string;
  pr_url?: string;
  merge_status: PlanTaskMergeStatus;
  changed_files: string[];
  validation_commands: string[];
  risks?: string[];
  follow_up?: string[];
}

export interface RunPlanTaskSequenceInput {
  repoPath: string;
  planPath: string;
  baseBranch: string;
  taskHints: string[];
  pollIntervalMs?: number;
  checksTimeoutMs?: number;
  maxCheckPolls?: number;
}

export interface RunPlanTaskSequenceTaskResult {
  task_hint: string;
  selected_task: string;
  status: 'merged' | 'blocked' | 'failed' | 'manual_review_required';
  attempts: number;
  repaired: boolean;
  branch_name?: string;
  pr_url?: string;
  pending_gate?: PlanRunnerPendingGate;
}

export interface RunPlanTaskSequenceResult {
  status: 'completed' | 'blocked' | 'failed' | 'manual_review_required';
  tasks: RunPlanTaskSequenceTaskResult[];
}

export interface PlanTaskSequenceDependencies {
  executeTaskSlice(input: {
    taskHint: string;
    repoPath: string;
    planPath: string;
    baseBranch: string;
  }): Promise<ExecutedTaskSlice>;
  getRequiredCheckStatus(input: { prUrl: string }): Promise<RequiredCheckStatus>;
  mergePullRequest(input: { prUrl: string }): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_POLLS = 60;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export async function runPlanTaskSequence(
  input: RunPlanTaskSequenceInput,
  deps: PlanTaskSequenceDependencies,
): Promise<RunPlanTaskSequenceResult> {
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxCheckPolls = resolveMaxPolls(input.maxCheckPolls, input.checksTimeoutMs ?? DEFAULT_TIMEOUT_MS, pollIntervalMs);
  const tasks: RunPlanTaskSequenceTaskResult[] = [];

  for (const taskHint of input.taskHints) {
    const execution = await deps.executeTaskSlice({
      taskHint,
      repoPath: input.repoPath,
      planPath: input.planPath,
      baseBranch: input.baseBranch,
    });

    if (execution.status !== 'completed' || execution.merge_status === 'not_opened' || !execution.pr_url) {
      const status = execution.status === 'failed' ? 'failed' : 'blocked';
      tasks.push({
        task_hint: taskHint,
        selected_task: execution.selected_task,
        status,
        attempts: 1,
        repaired: false,
        branch_name: execution.branch_name,
        pr_url: execution.pr_url,
      });

      return { status, tasks };
    }

    if (execution.merge_status === 'merged') {
      tasks.push({
        task_hint: taskHint,
        selected_task: execution.selected_task,
        status: 'failed',
        attempts: 1,
        repaired: false,
        branch_name: execution.branch_name,
        pr_url: execution.pr_url,
      });

      return { status: 'failed', tasks };
    }

    const checksStatus = await waitForRequiredChecks(
      execution.pr_url,
      maxCheckPolls,
      pollIntervalMs,
      deps,
    );

    if (checksStatus !== 'pass') {
      if (checksStatus === 'timed_out') {
        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status: 'manual_review_required',
          attempts: 1,
          repaired: false,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          pending_gate: 'required_checks',
        });

        return { status: 'manual_review_required', tasks };
      }

      tasks.push({
        task_hint: taskHint,
        selected_task: execution.selected_task,
        status: 'failed',
        attempts: 1,
        repaired: false,
        branch_name: execution.branch_name,
        pr_url: execution.pr_url,
      });

      return { status: 'failed', tasks };
    }

    await deps.mergePullRequest({ prUrl: execution.pr_url });
    tasks.push({
      task_hint: taskHint,
      selected_task: execution.selected_task,
      status: 'merged',
      attempts: 1,
      repaired: false,
      branch_name: execution.branch_name,
      pr_url: execution.pr_url,
    });
  }

  return { status: 'completed', tasks };
}

async function waitForRequiredChecks(
  prUrl: string,
  maxPolls: number,
  pollIntervalMs: number,
  deps: Pick<PlanTaskSequenceDependencies, 'getRequiredCheckStatus' | 'sleep'>,
): Promise<RequiredCheckStatus> {
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const status = await deps.getRequiredCheckStatus({ prUrl });
    if (status === 'cancelled') {
      if (poll === maxPolls) {
        return 'fail';
      }
    } else if (status !== 'pending') {
      return status;
    }

    if (poll < maxPolls) {
      await deps.sleep(pollIntervalMs);
    }
  }

  return 'timed_out';
}

function resolveMaxPolls(
  explicitMaxPolls: number | undefined,
  timeoutMs: number,
  pollIntervalMs: number,
): number {
  if (
    typeof explicitMaxPolls === 'number' &&
    Number.isFinite(explicitMaxPolls) &&
    explicitMaxPolls > 0
  ) {
    return explicitMaxPolls;
  }

  if (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0 &&
    typeof pollIntervalMs === 'number' &&
    Number.isFinite(pollIntervalMs) &&
    pollIntervalMs > 0
  ) {
    return Math.max(1, Math.floor(timeoutMs / pollIntervalMs) + 1);
  }

  return DEFAULT_MAX_POLLS;
}
