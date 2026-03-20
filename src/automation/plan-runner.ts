export type PlanTaskExecutionStatus = 'completed' | 'blocked' | 'failed';
export type PlanTaskMergeStatus = 'merged' | 'opened_not_merged' | 'not_opened';
export type RequiredCheckStatus = 'pending' | 'pass' | 'fail' | 'timed_out';
export type CodexReviewStatus = 'pending' | 'clean' | 'findings' | 'timed_out';
export type PlanRunnerPendingGate = 'required_checks' | 'codex_review';

export interface CodexReviewFinding {
  path?: string;
  body: string;
}

export interface CodexReviewState {
  status: CodexReviewStatus;
  review_id?: string;
  findings: CodexReviewFinding[];
}

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
  reviewTimeoutMs?: number;
  maxCheckPolls?: number;
  maxReviewPolls?: number;
  maxTaskAttempts?: number;
}

export interface RunPlanTaskSequenceTaskResult {
  task_hint: string;
  selected_task: string;
  status: 'merged' | 'blocked' | 'failed' | 'manual_review_required';
  attempts: number;
  repaired: boolean;
  branch_name?: string;
  pr_url?: string;
  review_id?: string;
  findings?: CodexReviewFinding[];
  pending_gate?: PlanRunnerPendingGate;
}

export interface RunPlanTaskSequenceResult {
  status: 'completed' | 'blocked' | 'failed' | 'manual_review_required';
  tasks: RunPlanTaskSequenceTaskResult[];
}

export interface PlanTaskSequenceDependencies {
  executeTaskSlice(input: {
    taskHint: string;
    attempt: number;
    repoPath: string;
    planPath: string;
    baseBranch: string;
    priorReview: CodexReviewState | null;
  }): Promise<ExecutedTaskSlice>;
  getRequiredCheckStatus(input: { prUrl: string }): Promise<RequiredCheckStatus>;
  getPullRequestHeadSha(input: { prUrl: string }): Promise<string>;
  getCodexReviewState(input: { prUrl: string; headSha: string }): Promise<CodexReviewState>;
  mergePullRequest(input: { prUrl: string }): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_POLLS = 60;
const DEFAULT_MAX_TASK_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export async function runPlanTaskSequence(
  input: RunPlanTaskSequenceInput,
  deps: PlanTaskSequenceDependencies,
): Promise<RunPlanTaskSequenceResult> {
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxCheckPolls = resolveMaxPolls(input.maxCheckPolls, input.checksTimeoutMs ?? DEFAULT_TIMEOUT_MS, pollIntervalMs);
  const reviewTimeoutMs = (
    typeof input.reviewTimeoutMs === 'number' &&
    Number.isFinite(input.reviewTimeoutMs) &&
    input.reviewTimeoutMs > 0
  )
    ? input.reviewTimeoutMs
    : DEFAULT_TIMEOUT_MS;
  const maxReviewPolls = resolveMaxPolls(input.maxReviewPolls, reviewTimeoutMs, pollIntervalMs);
  const singlePollConfirmationDelayMs = Math.min(pollIntervalMs, reviewTimeoutMs);
  const maxTaskAttempts = input.maxTaskAttempts ?? DEFAULT_MAX_TASK_ATTEMPTS;

  const tasks: RunPlanTaskSequenceTaskResult[] = [];

  for (const taskHint of input.taskHints) {
    let priorReview: CodexReviewState | null = null;
    let lastSelectedTask = taskHint;
    let lastBranchName: string | undefined;
    let lastPrUrl: string | undefined;

    for (let attempt = 1; attempt <= maxTaskAttempts; attempt += 1) {
      const execution = await deps.executeTaskSlice({
        taskHint,
        attempt,
        repoPath: input.repoPath,
        planPath: input.planPath,
        baseBranch: input.baseBranch,
        priorReview,
      });

      lastSelectedTask = execution.selected_task;
      lastBranchName = execution.branch_name;
      lastPrUrl = execution.pr_url;

      if (execution.status !== 'completed' || execution.merge_status === 'not_opened' || !execution.pr_url) {
        const status = execution.status === 'failed' ? 'failed' : 'blocked';
        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status,
          attempts: attempt,
          repaired: attempt > 1,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          findings: priorReview?.findings,
        });

        return { status, tasks };
      }

      if (execution.merge_status === 'merged') {
        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status: 'failed',
          attempts: attempt,
          repaired: attempt > 1,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          findings: priorReview?.findings,
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
            attempts: attempt,
            repaired: attempt > 1,
            branch_name: execution.branch_name,
            pr_url: execution.pr_url,
            findings: priorReview?.findings,
            pending_gate: 'required_checks',
          });

          return { status: 'manual_review_required', tasks };
        }

        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status: 'failed',
          attempts: attempt,
          repaired: attempt > 1,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          findings: priorReview?.findings,
        });

        return { status: 'failed', tasks };
      }

      const headSha = await deps.getPullRequestHeadSha({ prUrl: execution.pr_url });
      const review = await waitForCodexReview(
        execution.pr_url,
        headSha,
        maxReviewPolls,
        pollIntervalMs,
        singlePollConfirmationDelayMs,
        deps,
      );

      if (review.status === 'clean') {
        await deps.mergePullRequest({ prUrl: execution.pr_url });
        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status: 'merged',
          attempts: attempt,
          repaired: attempt > 1,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          review_id: review.review_id,
        });
        priorReview = null;
        break;
      }

      if (review.status === 'findings') {
        priorReview = review;
        continue;
      }

      if (review.status === 'timed_out') {
        tasks.push({
          task_hint: taskHint,
          selected_task: execution.selected_task,
          status: 'manual_review_required',
          attempts: attempt,
          repaired: attempt > 1,
          branch_name: execution.branch_name,
          pr_url: execution.pr_url,
          findings: review.findings.length > 0 ? review.findings : priorReview?.findings ?? [],
          pending_gate: 'codex_review',
        });

        return { status: 'manual_review_required', tasks };
      }

      tasks.push({
        task_hint: taskHint,
        selected_task: execution.selected_task,
        status: 'failed',
        attempts: attempt,
        repaired: attempt > 1,
        branch_name: execution.branch_name,
        pr_url: execution.pr_url,
        findings: review.findings,
      });

      return { status: 'failed', tasks };
    }

    const finalTask = tasks.at(-1);
    if (
      !finalTask ||
      finalTask.task_hint !== taskHint ||
      finalTask.status !== 'merged'
    ) {
      tasks.push({
        task_hint: taskHint,
        selected_task: lastSelectedTask,
        status: 'failed',
        attempts: maxTaskAttempts,
        repaired: maxTaskAttempts > 1,
        branch_name: lastBranchName,
        pr_url: lastPrUrl,
        findings: priorReview?.findings,
      });

      return { status: 'failed', tasks };
    }
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
    if (status !== 'pending') {
      return status;
    }

    if (poll < maxPolls) {
      await deps.sleep(pollIntervalMs);
    }
  }

  return 'timed_out';
}

async function waitForCodexReview(
  prUrl: string,
  headSha: string,
  maxPolls: number,
  pollIntervalMs: number,
  singlePollConfirmationDelayMs: number,
  deps: Pick<PlanTaskSequenceDependencies, 'getCodexReviewState' | 'sleep'>,
): Promise<CodexReviewState> {
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const state = await deps.getCodexReviewState({ prUrl, headSha });
    if (state.status !== 'pending') {
      return state;
    }

    // Only the single-poll configuration gets an extra debounce wait.
    // Multi-poll runs must keep using their later scheduled poll so delayed
    // inline comments cannot race the merge.
    if (
      maxPolls === 1 &&
      typeof state.review_id === 'string' &&
      state.findings.length === 0
    ) {
      await deps.sleep(singlePollConfirmationDelayMs);
      const confirmedState = await deps.getCodexReviewState({ prUrl, headSha });
      if (confirmedState.status !== 'pending') {
        return confirmedState;
      }
    }

    if (poll < maxPolls) {
      await deps.sleep(pollIntervalMs);
    }
  }

  return {
    status: 'timed_out',
    findings: [],
  };
}

function resolveMaxPolls(
  explicitMaxPolls: number | undefined,
  timeoutMs: number | undefined,
  pollIntervalMs: number,
): number {
  if (typeof explicitMaxPolls === 'number' && Number.isFinite(explicitMaxPolls) && explicitMaxPolls > 0) {
    return explicitMaxPolls;
  }

  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.max(1, Math.floor(timeoutMs / pollIntervalMs) + 1);
  }

  return DEFAULT_MAX_POLLS;
}
