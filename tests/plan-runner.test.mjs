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

test('runPlanTaskSequence waits for required checks and a clean local review before merging', async () => {
  const events = [];
  const checkStates = ['pending', 'pass'];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxCheckPolls: 5,
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
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      runCodexReview: async ({ prUrl, headSha, repoPath, baseBranch, changedFiles, taskHint }) => {
        events.push([
          'runCodexReview',
          prUrl,
          headSha,
          repoPath,
          baseBranch,
          changedFiles.join(','),
          taskHint,
          null,
        ]);
        return { status: 'clean', findings: [] };
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
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['runCodexReview', 'https://github.com/example/repo/pull/1', 'sha-current', '/tmp/repo', 'main', 'src/example.ts', 'Task 1: Example', null],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence reruns the same task when local review returns findings', async () => {
  const events = [];
  const headShas = ['sha-1', 'sha-2'];
  const reviewResults = [
    {
      status: 'findings',
      findings: [{ path: 'src/example.ts', body: 'Address edge-case handling.' }],
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
      maxCheckPolls: 3,
      maxTaskAttempts: 3,
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
      runCodexReview: async ({ prUrl, headSha, priorReview }) => {
        const review = reviewResults.shift() ?? { status: 'clean', findings: [] };
        events.push([
          'runCodexReview',
          prUrl,
          headSha,
          review.status,
          priorReview?.findings?.map((finding) => finding.body).join(' | ') ?? null,
        ]);
        return review;
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
      attempts: 2,
      repaired: true,
      branch_name: 'codex/task-1-attempt-2',
      pr_url: 'https://github.com/example/repo/pull/1',
    },
  ]);
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1, null],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-1'],
    ['runCodexReview', 'https://github.com/example/repo/pull/1', 'sha-1', 'findings', null],
    ['executeTaskSlice', 'Task 1: Example', 2, 'Address edge-case handling.'],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-2'],
    ['runCodexReview', 'https://github.com/example/repo/pull/1', 'sha-2', 'clean', 'Address edge-case handling.'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence returns manual_review_required when local review infrastructure fails', async () => {
  const events = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      pollIntervalMs: 1,
      maxCheckPolls: 3,
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
      runCodexReview: async ({ prUrl, headSha }) => {
        events.push(['runCodexReview', prUrl, headSha, 'manual_review_required']);
        return {
          status: 'manual_review_required',
          findings: [],
          risk_notes: ['Structured review process timed out after 1000ms.'],
        };
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
    status: 'manual_review_required',
    tasks: [
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
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['runCodexReview', 'https://github.com/example/repo/pull/1', 'sha-current', 'manual_review_required'],
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
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'should-not-run']);
        return 'should-not-run';
      },
      runCodexReview: async ({ prUrl, headSha }) => {
        events.push(['runCodexReview', prUrl, headSha, 'should-not-run']);
        return { status: 'clean', findings: [] };
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
    status: 'manual_review_required',
    tasks: [
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
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
  ]);
});

test('runPlanTaskSequence includes the final timeout-derived required-check poll before timing out', async () => {
  const events = [];
  const checkStates = ['pending', 'pending', 'pass'];

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
        const status = checkStates.shift() ?? 'pass';
        events.push(['getRequiredCheckStatus', prUrl, status]);
        return status;
      },
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'sha-current']);
        return 'sha-current';
      },
      runCodexReview: async ({ prUrl, headSha }) => {
        events.push(['runCodexReview', prUrl, headSha, 'clean']);
        return { status: 'clean', findings: [] };
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
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pass'],
    ['getPullRequestHeadSha', 'https://github.com/example/repo/pull/1', 'sha-current'],
    ['runCodexReview', 'https://github.com/example/repo/pull/1', 'sha-current', 'clean'],
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence treats a cancelled required check on the final poll as a failure', async () => {
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
      getPullRequestHeadSha: async ({ prUrl }) => {
        events.push(['getPullRequestHeadSha', prUrl, 'should-not-run']);
        return 'should-not-run';
      },
      runCodexReview: async ({ prUrl, headSha }) => {
        events.push(['runCodexReview', prUrl, headSha, 'should-not-run']);
        return { status: 'clean', findings: [] };
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
    status: 'failed',
    tasks: [
      {
        task_hint: 'Task 1: Example',
        selected_task: 'Task 1: Example',
        status: 'failed',
        attempts: 1,
        repaired: false,
        branch_name: 'codex/task-1',
        pr_url: 'https://github.com/example/repo/pull/1',
        findings: undefined,
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'cancelled'],
  ]);
});
