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
  const reviewStates = ['pending', { status: 'clean', review_id: 'review-1', findings: [] }];

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
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
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

test('runPlanTaskSequence allows a final review poll at the configured timeout boundary', async () => {
  const events = [];
  const reviewStates = [
    { status: 'pending', findings: [] },
    { status: 'pending', findings: [] },
    { status: 'clean', review_id: 'review-1', findings: [] },
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
    ['getCodexReviewState', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
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
