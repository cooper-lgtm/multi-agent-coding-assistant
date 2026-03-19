import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, 'scripts', 'run-plan-doc.mjs');
const fakeBinPath = path.join(projectRoot, 'tests', 'fixtures', 'fake-bin');

test('run-plan-doc executes parsed plan tasks in order and merges only after checks and clean reviews', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-script-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: First task',
        '',
        '### Task 2: Second task',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      statePath,
      JSON.stringify(
        {
          commands: [],
          gooseRuns: [
            {
              status: 'completed',
              selected_task: 'Task 1: First task',
              branch_name: 'codex/task-1',
              pr_url: 'https://github.com/example/repo/pull/101',
              merge_status: 'opened_not_merged',
              changed_files: ['src/task-one.ts'],
              validation_commands: ['npm run build'],
            },
            {
              status: 'completed',
              selected_task: 'Task 2: Second task',
              branch_name: 'codex/task-2',
              pr_url: 'https://github.com/example/repo/pull/102',
              merge_status: 'opened_not_merged',
              changed_files: ['src/task-two.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '101': ['pending', 'pass'],
            '102': ['pass'],
          },
          headShas: {
            '101': ['sha-101'],
            '102': ['sha-102'],
          },
          reviews: {
            '101': {
              'sha-101': [{ status: 'pending' }, { status: 'clean', review_id: 5001 }],
            },
            '102': {
              'sha-102': [{ status: 'clean', review_id: 5002 }],
            },
          },
          comments: {
            '101': {
              '5001': [],
            },
            '102': {
              '5002': [],
            },
          },
          merged: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    const output = execFileSync(
      'node',
      [
        scriptPath,
        '--repo-path',
        projectRoot,
        '--plan-path',
        planPath,
        '--base-branch',
        'main',
        '--poll-interval-ms',
        '1',
        '--max-check-polls',
        '5',
        '--max-review-polls',
        '5',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
          PLAN_RUNNER_FAKE_STATE: statePath,
        },
      },
    );

    const result = JSON.parse(output);
    assert.equal(result.status, 'completed');
    assert.deepEqual(
      result.tasks.map((task) => [task.task_hint, task.status, task.attempts]),
      [
        ['Task 1: First task', 'merged', 1],
        ['Task 2: Second task', 'merged', 1],
      ],
    );

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['101', '102']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: First task',
        'gh pr checks https://github.com/example/repo/pull/101 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/101 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/101 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/101/reviews',
        'gh api repos/example/repo/pulls/101/reviews',
        'gh api repos/example/repo/pulls/101/comments',
        'gh pr merge https://github.com/example/repo/pull/101 --merge --delete-branch',
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 2: Second task',
        'gh pr checks https://github.com/example/repo/pull/102 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/102 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/102/reviews',
        'gh api repos/example/repo/pulls/102/comments',
        'gh pr merge https://github.com/example/repo/pull/102 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc reruns the same task after Codex inline findings and merges only after a clean follow-up review', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-repair-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Repair task',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      statePath,
      JSON.stringify(
        {
          commands: [],
          gooseRuns: [
            {
              status: 'completed',
              selected_task: 'Task 1: Repair task',
              branch_name: 'codex/task-repair',
              pr_url: 'https://github.com/example/repo/pull/201',
              merge_status: 'opened_not_merged',
              changed_files: ['src/repair.ts'],
              validation_commands: ['npm run build'],
            },
            {
              status: 'completed',
              selected_task: 'Task 1: Repair task',
              branch_name: 'codex/task-repair',
              pr_url: 'https://github.com/example/repo/pull/201',
              merge_status: 'opened_not_merged',
              changed_files: ['src/repair.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '201': ['pass', 'pass'],
          },
          headShas: {
            '201': ['sha-201-a', 'sha-201-b'],
          },
          reviews: {
            '201': {
              'sha-201-a': [{ status: 'clean', review_id: 7001 }],
              'sha-201-b': [{ status: 'clean', review_id: 7002 }],
            },
          },
          comments: {
            '201': {
              '7001': [{ path: 'src/repair.ts', body: 'Please cover the retry edge case.' }],
              '7002': [],
            },
          },
          merged: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    const output = execFileSync(
      'node',
      [
        scriptPath,
        '--repo-path',
        projectRoot,
        '--plan-path',
        planPath,
        '--base-branch',
        'main',
        '--poll-interval-ms',
        '1',
        '--max-check-polls',
        '5',
        '--max-review-polls',
        '5',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
          PLAN_RUNNER_FAKE_STATE: statePath,
        },
      },
    );

    const result = JSON.parse(output);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.tasks, [
      {
        task_hint: 'Task 1: Repair task',
        selected_task: 'Task 1: Repair task',
        status: 'merged',
        attempts: 2,
        repaired: true,
        branch_name: 'codex/task-repair',
        pr_url: 'https://github.com/example/repo/pull/201',
        review_id: '7002',
      },
    ]);

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['201']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Repair task',
        'gh pr checks https://github.com/example/repo/pull/201 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/201 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/201/reviews',
        'gh api repos/example/repo/pulls/201/comments',
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Repair task',
        'gh pr checks https://github.com/example/repo/pull/201 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/201 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/201/reviews',
        'gh api repos/example/repo/pulls/201/comments',
        'gh pr merge https://github.com/example/repo/pull/201 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc returns manual_review_required when Codex review exceeds the configured timeout', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-timeout-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Slow review task',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      statePath,
      JSON.stringify(
        {
          commands: [],
          gooseRuns: [
            {
              status: 'completed',
              selected_task: 'Task 1: Slow review task',
              branch_name: 'codex/task-slow-review',
              pr_url: 'https://github.com/example/repo/pull/301',
              merge_status: 'opened_not_merged',
              changed_files: ['src/slow-review.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '301': ['pass'],
          },
          headShas: {
            '301': ['sha-301'],
          },
          reviews: {
            '301': {
              'sha-301': [{ status: 'pending' }, { status: 'pending' }],
            },
          },
          comments: {
            '301': {},
          },
          merged: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = spawnSync(
      'node',
      [
        scriptPath,
        '--repo-path',
        projectRoot,
        '--plan-path',
        planPath,
        '--base-branch',
        'main',
        '--poll-interval-ms',
        '1',
        '--review-timeout-ms',
        '2',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
          PLAN_RUNNER_FAKE_STATE: statePath,
        },
      },
    );

    assert.equal(result.status, 1);

    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      status: 'manual_review_required',
      tasks: [
        {
          task_hint: 'Task 1: Slow review task',
          selected_task: 'Task 1: Slow review task',
          status: 'manual_review_required',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-slow-review',
          pr_url: 'https://github.com/example/repo/pull/301',
          findings: [],
          pending_gate: 'codex_review',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Slow review task',
        'gh pr checks https://github.com/example/repo/pull/301 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/301 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/301/reviews',
        'gh api repos/example/repo/pulls/301/reviews',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
