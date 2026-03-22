import test from 'node:test';
import assert from 'node:assert/strict';

import { runPlanTaskSequence } from '../dist/index.js';

function buildTaskSliceResult(taskHint, overrides = {}) {
  return {
    status: 'completed',
    selected_task: taskHint,
    branch_name: 'codex/task-1',
    pr_url: 'https://github.com/example/repo/pull/1',
    merge_status: 'opened_not_merged',
    changed_files: ['src/example.ts'],
    validation_commands: ['npm run build'],
    risks: [],
    follow_up: [],
    ...overrides,
  };
}

test('runPlanTaskSequence waits for required checks and a clean current-head review before merging', async () => {
  const events = [];
  const checkStates = ['pending', 'pass'];
  const reviewStates = [
    'pending',
    { status: 'pending', review_id: 'review-1', findings: [] },
    { status: 'clean', review_id: 'review-1', findings: [] },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxCheckPolls: 5,
      maxReviewPolls: 5,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        const status = checkStates.shift() ?? 'pass';
        events.push(['getRequiredCheckStatus', prUrl, status]);
        return status;
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl]);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? { status: 'clean', review_id: 'review-1', findings: [] };
        events.push(['getCodexReviewState', prUrl, headSha, typeof state === 'string' ? state : state.status]);
        return typeof state === 'string' ? { status: state } : state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].status, 'merged');
  assert.equal(result.tasks[0].attempts, 1);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts a multi-poll clean confirmation when the follow-up fetch omits the review id', async () => {
  const events = [];
  const reviewStates = [
    { status: 'clean', review_id: 'review-1', findings: [] },
    { status: 'clean', findings: [] },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? { status: 'clean', findings: [] };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-1'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence fails closed when a multi-poll pending follow-up omits the review id', async () => {
  const events = [];
  const reviewStates = [
    { status: 'pending', review_id: 'review-1', findings: [] },
    { status: 'pending', findings: [] },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? { status: 'pending', findings: [] };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-1'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
  ]);
});

test('runPlanTaskSequence reruns the same task when Codex review returns findings for the current head', async () => {
  const events = [];
  const headShas = ['sha-1', 'sha-2'];
  const reviewStates = [
    {
      status: 'findings',
      review_id: 'review-1',
      findings: [{ path: 'src/example.ts', body: 'Address edge-case handling.' }],
    },
    {
      status: 'pending',
      review_id: 'review-2',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-2',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxCheckPolls: 3,
      maxReviewPolls: 3,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt, priorReview }) => {
        events.push([
          'executeTaskSlice',
          taskHint,
          attempt,
          priorReview?.findings?.map((finding) => finding.body).join(' | ') ?? null,
        ]);

        return buildTaskSliceResult(taskHint, {
          branch_name: `codex/task-1-attempt-${attempt}`,
        });
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        const headSha = headShas.shift() ?? 'sha-final';
        events.push(['getPullRequestHeadSha', prUrl, headSha]);
        return headSha;
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? { status: 'clean', review_id: 'review-final', findings: [] };
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].status, 'merged');
  assert.equal(result.tasks[0].attempts, 2);
  assert.equal(result.tasks[0].repaired, true);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1, null],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-1'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-1', 'findings'],
    ['executeTaskSlice', 'Task 1: Example', 2, 'Address edge-case handling.'],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-2'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-2', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-2', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence honors explicit max check polls even when a longer timeout is configured', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      checksTimeoutMs: 4,
      maxCheckPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pending']);
        return 'pending';
      },
      getPullRequestHeadSha: async () => {
        throw new Error('should not request head sha before checks pass');
      },
      getCodexReviewState: async () => {
        throw new Error('should not poll review before checks pass');
      },
      mergePullRequest: async () => {
        throw new Error('should not merge on timed out checks');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
  ]);
});

test('runPlanTaskSequence treats a cancelled required check on the final poll as a failure instead of manual review', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxCheckPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'cancelled']);
        return 'cancelled';
      },
      getPullRequestHeadSha: async () => {
        throw new Error('should not request head sha after a terminal cancelled check result');
      },
      getCodexReviewState: async () => {
        throw new Error('should not poll review after a terminal cancelled check result');
      },
      mergePullRequest: async () => {
        throw new Error('should not merge when the only required-check poll is cancelled');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'failed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'cancelled'],
  ]);
});

test('runPlanTaskSequence honors explicit max review polls even when a longer timeout is configured', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      reviewTimeoutMs: 4,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        events.push(['getCodexReviewState', prUrl, headSha, 'pending']);
        return { status: 'pending', findings: [] };
      },
      mergePullRequest: async () => {
        throw new Error('should not merge on timed out review');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
  ]);
});

test('runPlanTaskSequence confirms a debounced clean review when only one review poll is configured', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-1',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-1',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-1',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.tasks, [
    {
      task_hint: 'Task 1: Example',
      selected_task: 'Task 1: Example',
      status: 'merged',
      attempts: 1,
      repaired: false,
      branch_name: 'codex/task-1',
      pr_url: 'https://github.com/example/repo/pull/1',
      review_id: 'review-1',
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts repeated anonymous clean reviews in one-poll mode', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.tasks, [
    {
      task_hint: 'Task 1: Example',
      selected_task: 'Task 1: Example',
      status: 'merged',
      attempts: 1,
      repaired: false,
      branch_name: 'codex/task-1',
      pr_url: 'https://github.com/example/repo/pull/1',
      review_id: undefined,
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence treats a confirmed pending review with the same review id as clean in one-poll mode', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-1',
      findings: [],
    },
    {
      status: 'pending',
      review_id: 'review-1',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'pending',
          review_id: 'review-1',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-1'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-1'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence confirms a debounced clean review in one-poll mode after the review appears late', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'pending',
      review_id: 'review-late',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-late',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-late'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence confirms an already-clean first review fetch in one-poll mode before merging', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      review_id: 'review-stable',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-stable',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-stable',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-stable'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-stable'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence keeps the one-poll debounce when confirmation sees a replacement clean review after an initial clean', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      review_id: 'review-old',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-new',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-new',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-new',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-old'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-new'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-new'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence treats a late review as confirmed when the debounce fetch returns the same pending review id', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'pending',
      review_id: 'review-late',
      findings: [],
    },
    {
      status: 'pending',
      review_id: 'review-late',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'pending',
          review_id: 'review-late',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-late'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-late'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence keeps the late-review debounce even when the confirmation pass returns clean immediately', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-late',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence keeps the one-poll debounce when a replacement review id appears during confirmation', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-old',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-new',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-new',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-new',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-old'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-new'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-new'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts an anonymous clean confirmation after an initial pending fetch in one-poll mode', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts a clean confirmation without a repeated review id when the pending review was already identified', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-stable',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].review_id, 'review-stable');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-stable'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence does not merge when a replacement clean review appears during the extra debounce fetch', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-a',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-b',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-b',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async () => {
        throw new Error('should not merge while the replacement clean review has not been observed stable');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-a'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-b'],
  ]);
});

test('runPlanTaskSequence accepts a late clean review when the debounce fetch omits the review id for the same review', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].review_id, 'review-late');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts a late clean review when the debounce fetch first exposes its review id', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-late',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].review_id, 'review-late');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts a late anonymous clean review once the extra debounce repeats it', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.deepEqual(result, {
    status: 'completed',
    tasks: [
      {
        task_hint: 'Task 1: Example',
        selected_task: 'Task 1: Example',
        status: 'merged',
        attempts: 1,
        repaired: false,
        branch_name: 'codex/task-1',
        pr_url: 'https://github.com/example/repo/pull/1',
        review_id: undefined,
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence caps the extra one-poll debounce by the remaining timeout after slow review fetches', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
  ];
  let nowMs = 1_000;
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  try {
    const result = await runPlanTaskSequence(
      {
        repoPath: '/tmp/repo',
        planPath: '/tmp/plan.md',
        baseBranch: 'main',
        taskHints: ['Task 1: Example'],
        pollIntervalMs: 20,
        reviewTimeoutMs: 60,
        maxReviewPolls: 1,
      },
      {
        executeTaskSlice: async ({ taskHint, attempt }) => {
          events.push(['executeTaskSlice', taskHint, attempt]);
          return buildTaskSliceResult(taskHint);
        },
        getRequiredCheckStatus: async ({ prUrl }) => {
          events.push(['getRequiredCheckStatus', prUrl, 'pass']);
          return 'pass';
        },
        getPullRequestHeadSha: async ({ prUrl }) => {
          events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
          return 'sha-current';
        },
        getCodexReviewState: async ({ prUrl, headSha }) => {
          nowMs += 15;
          const state = reviewStates.shift() ?? {
            status: 'clean',
            review_id: 'review-late',
            findings: [],
          };
          events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
          return state;
        },
        mergePullRequest: async ({ prUrl }) => {
          events.push(['mergePullRequest', prUrl]);
        },
        sleep: async (ms) => {
          nowMs += ms;
          events.push(['sleep', ms]);
        },
      },
    );

    assert.equal(result.status, 'manual_review_required');
    assert.deepEqual(events.slice(0, 4), [
      ['executeTaskSlice', 'Task 1: Example', 1],
      ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
      ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ]);
    assert.deepEqual(events[4][0], 'sleep');
    assert.ok(events[4][1] >= 0 && events[4][1] <= 20, `expected confirmation sleep to stay within the one-poll timeout budget, got ${events[4][1]}`);
    assert.deepEqual(events[5], [
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ][0]);
    assert.equal(events.length, 8);
    assert.deepEqual(events[6][0], 'sleep');
    assert.ok(events[6][1] >= 0 && events[6][1] <= 10, `expected capped debounce sleep to stay within remaining timeout budget, got ${events[6][1]}`);
    assert.deepEqual(events.slice(7), [
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test('runPlanTaskSequence fails closed when a late clean review appears after the debounce budget is exhausted', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-late',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 10,
      reviewTimeoutMs: 10,
      maxReviewPolls: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-late',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
        return state;
      },
      mergePullRequest: async () => {
        throw new Error('should not merge without a stable follow-up review poll');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events.slice(0, 4), [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
  ]);
  assert.deepEqual(events[4][0], 'sleep');
  assert.ok(events[4][1] >= 0 && events[4][1] <= 10, `expected confirmation sleep to stay within the remaining timeout budget, got ${events[4][1]}`);
  assert.deepEqual(events.slice(5), [
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-late'],
  ]);
});

test('runPlanTaskSequence keeps the debounce on the final poll when more than one review poll is configured', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'pending',
      review_id: 'review-2',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-2',
          findings: [],
        };
        events.push([
          'getCodexReviewState',
          prUrl,
          headSha,
          state.status,
          state.review_id ?? null,
        ]);
        return state;
      },
      mergePullRequest: async () => {
        throw new Error('should not merge while the clean review debounce is still pending');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-2'],
  ]);
});

test('runPlanTaskSequence requires a second clean observation before merging when more than one review poll is configured', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      review_id: 'review-stable',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-stable',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-stable',
          findings: [],
        };
        events.push([
          'getCodexReviewState',
          prUrl,
          headSha,
          state.status,
          state.review_id ?? null,
        ]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-stable'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-stable'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence accepts repeated clean observations without review ids when more than one review poll is configured', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      findings: [],
    },
    {
      status: 'clean',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          findings: [],
        };
        events.push([
          'getCodexReviewState',
          prUrl,
          headSha,
          state.status,
          state.review_id ?? null,
        ]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence fails closed when the first clean observation arrives on the final multi-poll review fetch', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-final-only',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxReviewPolls: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-final-only',
          findings: [],
        };
        events.push([
          'getCodexReviewState',
          prUrl,
          headSha,
          state.status,
          state.review_id ?? null,
        ]);
        return state;
      },
      mergePullRequest: async () => {
        throw new Error('should not merge without a follow-up clean review observation');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-final-only'],
  ]);
});

test('runPlanTaskSequence caps the single-poll confirmation wait at the configured review timeout', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-timeout-capped',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-timeout-capped',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 10,
      reviewTimeoutMs: 4,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-timeout-capped',
          findings: [],
        };
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(events.slice(0, 4), [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
  ]);
  assert.equal(events[4]?.[0], 'sleep');
  assert.ok(events[4][1] >= 0 && events[4][1] <= 4, `expected confirmation sleep to stay within the 4ms timeout cap, got ${events[4][1]}`);
  assert.deepEqual(events.slice(5), [
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence fails closed when the confirmation fetch itself exceeds the one-poll review timeout', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-timeout-late',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-timeout-late',
      findings: [],
    },
  ];
  let nowMs = 2_000;
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  try {
    const result = await runPlanTaskSequence(
      {
        repoPath: '/tmp/repo',
        planPath: '/tmp/plan.md',
        baseBranch: 'main',
        taskHints: ['Task 1: Example'],
        pollIntervalMs: 10,
        reviewTimeoutMs: 40,
        maxReviewPolls: 1,
      },
      {
        executeTaskSlice: async ({ taskHint, attempt }) => {
          events.push(['executeTaskSlice', taskHint, attempt]);
          return buildTaskSliceResult(taskHint);
        },
        getRequiredCheckStatus: async ({ prUrl }) => {
          events.push(['getRequiredCheckStatus', prUrl, 'pass']);
          return 'pass';
        },
        getPullRequestHeadSha: async ({ prUrl }) => {
          events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
          return 'sha-current';
        },
        getCodexReviewState: async ({ prUrl, headSha }) => {
          nowMs += 25;
          const state = reviewStates.shift() ?? {
            status: 'clean',
            review_id: 'review-timeout-late',
            findings: [],
          };
          events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
          return state;
        },
        mergePullRequest: async () => {
          throw new Error('should not merge when the confirmation fetch lands after the timeout budget');
        },
        sleep: async (ms) => {
          nowMs += ms;
          events.push(['sleep', ms]);
        },
      },
    );

    assert.equal(result.status, 'manual_review_required');
    assert.deepEqual(events.slice(0, 4), [
      ['executeTaskSlice', 'Task 1: Example', 1],
      ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
      ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', 'review-timeout-late'],
    ]);
    assert.deepEqual(events[4][0], 'sleep');
    assert.ok(events[4][1] >= 0 && events[4][1] <= 10, `expected confirmation sleep to stay within the remaining timeout budget, got ${events[4][1]}`);
    assert.deepEqual(events.slice(5), [
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-timeout-late'],
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test('runPlanTaskSequence fails closed when the late-review debounce fetch itself exceeds the one-poll review timeout', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-timeout-debounce',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-timeout-debounce',
      findings: [],
    },
  ];
  let nowMs = 3_000;
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  try {
    const result = await runPlanTaskSequence(
      {
        repoPath: '/tmp/repo',
        planPath: '/tmp/plan.md',
        baseBranch: 'main',
        taskHints: ['Task 1: Example'],
        pollIntervalMs: 10,
        reviewTimeoutMs: 55,
        maxReviewPolls: 1,
      },
      {
        executeTaskSlice: async ({ taskHint, attempt }) => {
          events.push(['executeTaskSlice', taskHint, attempt]);
          return buildTaskSliceResult(taskHint);
        },
        getRequiredCheckStatus: async ({ prUrl }) => {
          events.push(['getRequiredCheckStatus', prUrl, 'pass']);
          return 'pass';
        },
        getPullRequestHeadSha: async ({ prUrl }) => {
          events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
          return 'sha-current';
        },
        getCodexReviewState: async ({ prUrl, headSha }) => {
          nowMs += 15;
          const state = reviewStates.shift() ?? {
            status: 'clean',
            review_id: 'review-timeout-debounce',
            findings: [],
          };
          events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
          return state;
        },
        mergePullRequest: async () => {
          throw new Error('should not merge when the debounce fetch lands after the timeout budget');
        },
        sleep: async (ms) => {
          nowMs += ms;
          events.push(['sleep', ms]);
        },
      },
    );

    assert.equal(result.status, 'manual_review_required');
    assert.deepEqual(events.slice(0, 6), [
      ['executeTaskSlice', 'Task 1: Example', 1],
      ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
      ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending', null],
      ['sleep', 10],
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-timeout-debounce'],
    ]);
    assert.deepEqual(events[6], ['sleep', 10]);
    assert.deepEqual(events.slice(7), [
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-timeout-debounce'],
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test('runPlanTaskSequence fails closed when the first single-poll review fetch exhausts the timeout budget', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'pending',
      review_id: 'review-timeout-exhausted',
      findings: [],
    },
    {
      status: 'clean',
      review_id: 'review-timeout-exhausted',
      findings: [],
    },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 20,
      reviewTimeoutMs: 10,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? {
          status: 'clean',
          review_id: 'review-timeout-exhausted',
          findings: [],
        };
        if (state.status === 'pending') {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
  ]);
});

test('runPlanTaskSequence fails closed when the initial one-poll review fetch exceeds the timeout budget and returns clean', async () => {
  const events = [];
  const reviewStates = [
    {
      status: 'clean',
      review_id: 'review-timeout-initial-clean',
      findings: [],
    },
  ];
  let nowMs = 4_000;
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  try {
    const result = await runPlanTaskSequence(
      {
        repoPath: '/tmp/repo',
        planPath: '/tmp/plan.md',
        baseBranch: 'main',
        taskHints: ['Task 1: Example'],
        pollIntervalMs: 20,
        reviewTimeoutMs: 10,
        maxReviewPolls: 1,
      },
      {
        executeTaskSlice: async ({ taskHint, attempt }) => {
          events.push(['executeTaskSlice', taskHint, attempt]);
          return buildTaskSliceResult(taskHint);
        },
        getRequiredCheckStatus: async ({ prUrl }) => {
          events.push(['getRequiredCheckStatus', prUrl, 'pass']);
          return 'pass';
        },
        getPullRequestHeadSha: async ({ prUrl }) => {
          events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
          return 'sha-current';
        },
        getCodexReviewState: async ({ prUrl, headSha }) => {
          nowMs += 15;
          const state = reviewStates.shift() ?? {
            status: 'clean',
            review_id: 'review-timeout-initial-clean',
            findings: [],
          };
          events.push(['getCodexReviewState', prUrl, headSha, state.status, state.review_id ?? null]);
          return state;
        },
        mergePullRequest: async () => {
          throw new Error('should not merge when the first review fetch lands after the timeout budget');
        },
        sleep: async (ms) => {
          nowMs += ms;
          events.push(['sleep', ms]);
        },
      },
    );

    assert.equal(result.status, 'manual_review_required');
    assert.deepEqual(events, [
      ['executeTaskSlice', 'Task 1: Example', 1],
      ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
      ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
      ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean', 'review-timeout-initial-clean'],
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test('runPlanTaskSequence allows a final review poll at the configured timeout boundary', async () => {
  const events = [];
  const reviewStates = [
    { status: 'pending', findings: [] },
    { status: 'pending', review_id: 'review-1', findings: [] },
    { status: 'pending', review_id: 'review-1', findings: [] },
  ];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 10,
      reviewTimeoutMs: 20,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        const state = reviewStates.shift() ?? { status: 'clean', review_id: 'review-final', findings: [] };
        events.push(['getCodexReviewState', prUrl, headSha, state.status]);
        return state;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks[0].status, 'merged');
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 10],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 10],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence returns manual_review_required when required checks do not finish before timeout', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      checksTimeoutMs: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pending']);
        return 'pending';
      },
      getPullRequestHeadSha: async () => {
        throw new Error('should not request head sha before checks pass');
      },
      getCodexReviewState: async () => {
        throw new Error('should not poll review before checks pass');
      },
      mergePullRequest: async () => {
        throw new Error('should not merge on timed out checks');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(result.tasks, [
    {
      task_hint: 'Task 1: Example',
      selected_task: 'Task 1: Example',
      status: 'manual_review_required',
      attempts: 1,
      repaired: false,
      branch_name: 'codex/task-1',
      pr_url: 'https://github.com/example/repo/pull/1',
      findings: undefined,
      pending_gate: 'required_checks',
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
  ]);
});

test('runPlanTaskSequence preserves prior findings when a repair attempt times out waiting for follow-up review', async () => {
  const headShas = ['sha-1', 'sha-2'];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      reviewTimeoutMs: 1,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        return buildTaskSliceResult(taskHint, {
          branch_name: `codex/task-1-attempt-${attempt}`,
        });
      },
      getRequiredCheckStatus: async () => 'pass',
      getPullRequestHeadSha: async ({ prUrl }) => {
        return headShas.shift() ?? 'sha-final';
      },
      getCodexReviewState: async ({ headSha }) => {
        if (headSha === 'sha-1') {
          return {
            status: 'findings',
            review_id: 'review-1',
            findings: [{ path: 'src/example.ts', body: 'Address edge-case handling.' }],
          };
        }

        return { status: 'pending', findings: [] };
      },
      mergePullRequest: async () => {
        throw new Error('should not merge on timed out repair review');
      },
      sleep: async () => {},
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(result.tasks, [
    {
      task_hint: 'Task 1: Example',
      selected_task: 'Task 1: Example',
      status: 'manual_review_required',
      attempts: 2,
      repaired: true,
      branch_name: 'codex/task-1-attempt-2',
      pr_url: 'https://github.com/example/repo/pull/1',
      findings: [{ path: 'src/example.ts', body: 'Address edge-case handling.' }],
      pending_gate: 'codex_review',
    },
  ]);
});

test('runPlanTaskSequence returns manual_review_required when Codex review does not finish before timeout', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      reviewTimeoutMs: 2,
    },
    {
      executeTaskSlice: async ({ taskHint, attempt }) => {
        events.push(['executeTaskSlice', taskHint, attempt]);
        return buildTaskSliceResult(taskHint);
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'pass']);
        return 'pass';
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      getCodexReviewState: async ({ prUrl, headSha }) => {
        events.push(['getCodexReviewState', prUrl, headSha, 'pending']);
        return { status: 'pending', findings: [] };
      },
      mergePullRequest: async () => {
        throw new Error('should not merge on timed out review');
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
    },
  );

  assert.equal(result.status, 'manual_review_required');
  assert.deepEqual(result.tasks, [
    {
      task_hint: 'Task 1: Example',
      selected_task: 'Task 1: Example',
      status: 'manual_review_required',
      attempts: 1,
      repaired: false,
      branch_name: 'codex/task-1',
      pr_url: 'https://github.com/example/repo/pull/1',
      findings: [],
      pending_gate: 'codex_review',
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
    ['sleep', 1],
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'pending'],
  ]);
});
