import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePlanDocument, runPlanTaskSequence } from '../dist/index.js';

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

test('parsePlanDocument extracts linked design docs and task docs from the implementation plan format', () => {
  const markdown = [
    '# Example Implementation Plan',
    '',
    '**Design Doc:** `docs/plans/2026-04-01-example-design.md`',
    '',
    '### Task 1: First task',
    '',
    '**Task docs:**',
    '- `docs/goose/pr-workflow.md`',
    '- `src/automation/plan-runner.ts`',
    '',
    '### Task 2: Second task',
    '',
    '**Task docs:**',
    '- `docs/goose/task-contract.md`',
    '',
  ].join('\n');

  assert.deepEqual(parsePlanDocument(markdown), {
    task_hints: [
      'Task 1: First task',
      'Task 2: Second task',
    ],
    design_doc_path: 'docs/plans/2026-04-01-example-design.md',
    task_docs_by_hint: {
      'Task 1: First task': [
        'docs/goose/pr-workflow.md',
        'src/automation/plan-runner.ts',
      ],
      'Task 2: Second task': [
        'docs/goose/task-contract.md',
      ],
    },
  });
});

test('parsePlanDocument stops task-doc collection before unrelated prose and bullet lists', () => {
  const markdown = [
    '# Example Implementation Plan',
    '',
    '**Design Doc:** `docs/plans/2026-04-01-example-design.md`',
    '',
    '### Task 1: First task',
    '',
    '**Task docs:**',
    '- `docs/goose/pr-workflow.md`',
    '',
    '- `src/automation/plan-runner.ts`',
    '',
    'This task also needs ordinary narrative context.',
    '',
    '- this bullet is not a file path',
    '- neither is this one',
    '',
    '**Validation:**',
    '- `npm run build`',
    '',
  ].join('\n');

  assert.deepEqual(parsePlanDocument(markdown), {
    task_hints: ['Task 1: First task'],
    design_doc_path: 'docs/plans/2026-04-01-example-design.md',
    task_docs_by_hint: {
      'Task 1: First task': [
        'docs/goose/pr-workflow.md',
        'src/automation/plan-runner.ts',
      ],
    },
  });
});

test('parsePlanDocument normalizes markdown links with optional titles', () => {
  const markdown = [
    '# Example Implementation Plan',
    '',
    '**Design Doc:** [Design](docs/plans/2026-04-01-example-design.md "Design doc")',
    '',
    '### Task 1: First task',
    '',
    '**Task docs:**',
    '- [Workflow](docs/goose/pr-workflow.md "Workflow guidance")',
    '',
  ].join('\n');

  assert.deepEqual(parsePlanDocument(markdown), {
    task_hints: ['Task 1: First task'],
    design_doc_path: 'docs/plans/2026-04-01-example-design.md',
    task_docs_by_hint: {
      'Task 1: First task': [
        'docs/goose/pr-workflow.md',
      ],
    },
  });
});

test('runPlanTaskSequence waits for required checks before merging', async () => {
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
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
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
    ['mergePullRequest', 'https://github.com/example/repo/pull/1'],
  ]);
});

test('runPlanTaskSequence forwards linked design and task docs to task execution', async () => {
  const received = [];

  const result = await runPlanTaskSequence(
    {
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      taskHints: ['Task 1: Example'],
      planDesignDocPath: 'docs/plans/2026-04-01-example-design.md',
      taskDocsByHint: {
        'Task 1: Example': [
          'docs/goose/pr-workflow.md',
          'src/automation/plan-runner.ts',
        ],
      },
      pollIntervalMs: 1,
      maxCheckPolls: 1,
    },
    {
      executeTaskSlice: async (input) => {
        received.push(input);
        return buildTaskSliceResult(input.taskHint);
      },
      getRequiredCheckStatus: async () => 'pass',
      mergePullRequest: async () => {},
      sleep: async () => {},
    },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(received, [
    {
      taskHint: 'Task 1: Example',
      repoPath: '/tmp/repo',
      planPath: '/tmp/plan.md',
      baseBranch: 'main',
      attempt: 1,
      designDocPath: 'docs/plans/2026-04-01-example-design.md',
      taskDocPaths: [
        'docs/goose/pr-workflow.md',
        'src/automation/plan-runner.ts',
      ],
    },
  ]);
});

test('runPlanTaskSequence fails when required checks fail', async () => {
  const events = [];
  const checkStates = ['pending', 'fail'];

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
        const status = checkStates.shift() ?? 'fail';
        events.push(['getRequiredCheckStatus', prUrl, status]);
        return status;
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
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
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'pending'],
    ['sleep', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'fail'],
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
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
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
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
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
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
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
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
    ['getRequiredCheckStatus', 'https://github.com/example/repo/pull/1', 'cancelled'],
  ]);
});

test('runPlanTaskSequence returns blocked when the task slice never opens a PR', async () => {
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
        return buildTaskSliceResult(taskHint, {
          status: 'blocked',
          pr_url: undefined,
          merge_status: 'not_opened',
        });
      },
      getRequiredCheckStatus: async ({ prUrl }) => {
        events.push(['getRequiredCheckStatus', prUrl, 'should-not-run']);
        return 'should-not-run';
      },
      mergePullRequest: async ({ prUrl }) => {
        events.push(['mergePullRequest', prUrl]);
      },
      sleep: async (ms) => {
        events.push(['sleep', ms]);
      },
      getPullRequestHeadSha: async () => {
        throw new Error('legacy post-check review lookup should not run');
      },
      runCodexReview: async () => {
        throw new Error('legacy post-check review should not run');
      },
    },
  );

  assert.deepEqual(result, {
    status: 'blocked',
    tasks: [
      {
        task_hint: 'Task 1: Example',
        selected_task: 'Task 1: Example',
        status: 'blocked',
        attempts: 1,
        repaired: false,
        branch_name: 'codex/task-1',
        pr_url: undefined,
      },
    ],
  });
  assert.deepEqual(events, [
    ['executeTaskSlice', 'Task 1: Example', 1],
  ]);
});
