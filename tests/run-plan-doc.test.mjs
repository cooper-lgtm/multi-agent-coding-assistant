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
              'sha-101': [
                { status: 'pending' },
                { status: 'clean', review_id: 5001 },
                { status: 'clean', review_id: 5001 },
              ],
            },
            '102': {
              'sha-102': [
                { status: 'clean', review_id: 5002 },
                { status: 'clean', review_id: 5002 },
              ],
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
        'gh api --paginate --slurp repos/example/repo/pulls/101/comments',
        'gh api repos/example/repo/pulls/101/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/101/comments',
        'gh pr merge https://github.com/example/repo/pull/101 --merge --delete-branch',
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 2: Second task',
        'gh pr checks https://github.com/example/repo/pull/102 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/102 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/102/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/102/comments',
        'gh api repos/example/repo/pulls/102/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/102/comments',
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
              'sha-201-b': [
                { status: 'clean', review_id: 7002 },
                { status: 'clean', review_id: 7002 },
              ],
            },
          },
          comments: {
            '201': {
              '7001': [
                [],
                [{ path: 'src/repair.ts', body: 'Please cover the retry edge case.' }],
              ],
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
    assert.deepEqual(finalState.commands[5], {
      bin: 'goose',
      argv: [
        'run',
        '--recipe',
        '.goose/recipes/execute-next-plan-task.yaml',
        '--quiet',
        '--no-session',
        '--output-format',
        'json',
        '--system',
        'Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging.',
        '--params',
        `repo_path=${projectRoot}`,
        '--params',
        `plan_path=${planPath}`,
        '--params',
        'base_branch=main',
        '--params',
        'task_hint=Task 1: Repair task',
        '--params',
        'prior_review=[{"path":"src/repair.ts","body":"Please cover the retry edge case."}]',
      ],
    });
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Repair task',
        'gh pr checks https://github.com/example/repo/pull/201 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/201 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/201/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/201/comments',
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Repair task --params prior_review=[{"path":"src/repair.ts","body":"Please cover the retry edge case."}]',
        'gh pr checks https://github.com/example/repo/pull/201 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/201 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/201/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/201/comments',
        'gh api repos/example/repo/pulls/201/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/201/comments',
        'gh pr merge https://github.com/example/repo/pull/201 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc keeps polling when a current-head review exists before its inline findings land', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-review-race-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Race task',
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
              selected_task: 'Task 1: Race task',
              branch_name: 'codex/task-race',
              pr_url: 'https://github.com/example/repo/pull/401',
              merge_status: 'opened_not_merged',
              changed_files: ['src/race.ts'],
              validation_commands: ['npm run build'],
            },
            {
              status: 'completed',
              selected_task: 'Task 1: Race task',
              branch_name: 'codex/task-race',
              pr_url: 'https://github.com/example/repo/pull/401',
              merge_status: 'opened_not_merged',
              changed_files: ['src/race.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '401': ['pass', 'pass'],
          },
          headShas: {
            '401': ['sha-401-a', 'sha-401-b'],
          },
          reviews: {
            '401': {
              'sha-401-a': [
                { status: 'clean', review_id: 8001 },
                { status: 'clean', review_id: 8001 },
              ],
              'sha-401-b': [
                { status: 'clean', review_id: 8002 },
                { status: 'clean', review_id: 8002 },
              ],
            },
          },
          comments: {
            '401': {
              '8001': {
                polls: [
                  [],
                  [{ path: 'src/race.ts', body: 'Late finding lands after review object.' }],
                ],
              },
              '8002': {
                polls: [[], []],
              },
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
        task_hint: 'Task 1: Race task',
        selected_task: 'Task 1: Race task',
        status: 'merged',
        attempts: 2,
        repaired: true,
        branch_name: 'codex/task-race',
        pr_url: 'https://github.com/example/repo/pull/401',
        review_id: '8002',
      },
    ]);

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['401']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Race task',
        'gh pr checks https://github.com/example/repo/pull/401 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/401 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/401/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/401/comments',
        'gh api repos/example/repo/pulls/401/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/401/comments',
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Race task --params prior_review=[{"path":"src/race.ts","body":"Late finding lands after review object."}]',
        'gh pr checks https://github.com/example/repo/pull/401 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/401 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/401/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/401/comments',
        'gh api repos/example/repo/pulls/401/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/401/comments',
        'gh pr merge https://github.com/example/repo/pull/401 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc keeps waiting when required checks are cancelled and later rerun clean', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Terminal check task',
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
              selected_task: 'Task 1: Terminal check task',
              branch_name: 'codex/task-terminal-check',
              pr_url: 'https://github.com/example/repo/pull/501',
              merge_status: 'opened_not_merged',
              changed_files: ['src/terminal-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '501': ['cancel', 'pass'],
          },
          headShas: {
            '501': ['sha-501'],
          },
          reviews: {
            '501': {
              'sha-501': [
                { status: 'clean', review_id: 8501 },
                { status: 'clean', review_id: 8501 },
              ],
            },
          },
          comments: {
            '501': {
              '8501': [],
            },
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
        '--checks-timeout-ms',
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

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Terminal check task',
          selected_task: 'Task 1: Terminal check task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-terminal-check',
          pr_url: 'https://github.com/example/repo/pull/501',
          review_id: '8501',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['501']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Terminal check task',
        'gh pr checks https://github.com/example/repo/pull/501 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/501 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/501 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-501/check-runs',
        'gh pr checks https://github.com/example/repo/pull/501 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/501 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/501/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/501/comments',
        'gh api repos/example/repo/pulls/501/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/501/comments',
        'gh pr merge https://github.com/example/repo/pull/501 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc resets the cancelled-check grace poll when a new workflow generation replaces the old cancelled run', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-generation-reset-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled generation reset task',
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
              selected_task: 'Task 1: Cancelled generation reset task',
              branch_name: 'codex/task-cancel-generation-reset',
              pr_url: 'https://github.com/example/repo/pull/512',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-generation-reset.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '512': [
              [
                {
                  bucket: 'cancelled',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/1/job/1',
                  startedAt: '2026-03-21T00:00:00Z',
                  state: 'cancelled',
                  workflow: 'CI Tests',
                },
              ],
              [
                {
                  bucket: 'cancelled',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'cancelled',
                  workflow: 'CI Tests',
                },
              ],
              ['pass'],
            ],
          },
          headShas: {
            '512': ['sha-512'],
          },
          reviews: {
            '512': {
              'sha-512': [
                { status: 'clean', review_id: 9012 },
                { status: 'clean', review_id: 9012 },
              ],
            },
          },
          comments: {
            '512': {
              '9012': [],
            },
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
        '--checks-timeout-ms',
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

    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled generation reset task',
          selected_task: 'Task 1: Cancelled generation reset task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-generation-reset',
          pr_url: 'https://github.com/example/repo/pull/512',
          review_id: '9012',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['512']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Cancelled generation reset task',
        'gh pr checks https://github.com/example/repo/pull/512 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/512 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/512 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-512/check-runs',
        'gh pr checks https://github.com/example/repo/pull/512 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/512 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/512 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-512/check-runs',
        'gh pr checks https://github.com/example/repo/pull/512 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/512 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/512/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/512/comments',
        'gh api repos/example/repo/pulls/512/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/512/comments',
        'gh pr merge https://github.com/example/repo/pull/512 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc trusts the detailed cancelled-check refresh when the replacement run is already passing', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-pass-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail refresh task',
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
              selected_task: 'Task 1: Cancelled detail refresh task',
              branch_name: 'codex/task-cancel-detail-refresh',
              pr_url: 'https://github.com/example/repo/pull/513',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-refresh.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '513': ['cancelled'],
          },
          checkDetails: {
            '513': [
              [
                {
                  bucket: 'pass',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
              ],
            ],
          },
          headShas: {
            '513': ['sha-513'],
          },
          reviews: {
            '513': {
              'sha-513': [
                { status: 'clean', review_id: 9013 },
                { status: 'clean', review_id: 9013 },
              ],
            },
          },
          comments: {
            '513': {
              '9013': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail refresh task',
          selected_task: 'Task 1: Cancelled detail refresh task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-refresh',
          pr_url: 'https://github.com/example/repo/pull/513',
          review_id: '9013',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc trusts mixed detailed cancelled rows when the latest run for the required check is passing', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-mixed-pass-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail mixed pass task',
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
              selected_task: 'Task 1: Cancelled detail mixed pass task',
              branch_name: 'codex/task-cancel-detail-mixed-pass',
              pr_url: 'https://github.com/example/repo/pull/513',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-mixed-pass.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '513': ['cancelled'],
          },
          checkDetails: {
            '513': [
              [
                {
                  bucket: 'pass',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
                {
                  bucket: 'cancelled',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'cancelled',
                  workflow: 'CI Tests',
                },
              ],
            ],
          },
          headShas: {
            '513': ['sha-513'],
          },
          checkRuns: {
            'sha-513': [
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                external_id: 'rerun-cancelled-detail-pass',
              },
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                external_id: 'rerun-cancelled-detail-pass',
              },
            ],
          },
          reviews: {
            '513': {
              'sha-513': [
                { status: 'clean', review_id: 9013 },
                { status: 'clean', review_id: 9013 },
              ],
            },
          },
          comments: {
            '513': {
              '9013': [],
            },
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
        '--checks-timeout-ms',
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

    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail mixed pass task',
          selected_task: 'Task 1: Cancelled detail mixed pass task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-mixed-pass',
          pr_url: 'https://github.com/example/repo/pull/513',
          review_id: '9013',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['513']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Cancelled detail mixed pass task',
        'gh pr checks https://github.com/example/repo/pull/513 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/513 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/513 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-513/check-runs',
        'gh pr view https://github.com/example/repo/pull/513 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/513/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/513/comments',
        'gh api repos/example/repo/pulls/513/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/513/comments',
        'gh pr merge https://github.com/example/repo/pull/513 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not treat an older pass as recovered when the latest rerun for the same required check is cancelled', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-latest-cancelled-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail latest cancelled task',
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
              selected_task: 'Task 1: Cancelled detail latest cancelled task',
              branch_name: 'codex/task-cancel-detail-latest-cancelled',
              pr_url: 'https://github.com/example/repo/pull/513',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-latest-cancelled.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '513': ['cancelled'],
          },
          checkDetails: {
            '513': [
              [
                {
                  bucket: 'pass',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
                {
                  bucket: 'cancelled',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI Tests',
                },
              ],
            ],
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail latest cancelled task',
          selected_task: 'Task 1: Cancelled detail latest cancelled task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-latest-cancelled',
          pr_url: 'https://github.com/example/repo/pull/513',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not let a newer cancelled rerun lose to an older pass when completedAt is still null', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-null-completed-at-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail null completedAt task',
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
              selected_task: 'Task 1: Cancelled detail null completedAt task',
              branch_name: 'codex/task-cancel-detail-null-completed-at',
              pr_url: 'https://github.com/example/repo/pull/516',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-null-completed-at.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '516': ['cancelled'],
          },
          checkDetails: {
            '516': [
              [
                {
                  bucket: 'pass',
                  completedAt: '2026-03-21T00:03:00Z',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
                {
                  bucket: 'cancelled',
                  completedAt: null,
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI Tests',
                },
              ],
            ],
          },
          headShas: {
            '516': ['sha-516'],
          },
          reviews: {
            '516': {
              'sha-516': [
                { status: 'clean', review_id: 9016 },
                { status: 'clean', review_id: 9016 },
              ],
            },
          },
          comments: {
            '516': {
              '9016': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail null completedAt task',
          selected_task: 'Task 1: Cancelled detail null completedAt task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-null-completed-at',
          pr_url: 'https://github.com/example/repo/pull/516',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not treat mixed pass and cancelled detailed checks as recovered when different required checks are involved', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-different-checks-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail different checks task',
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
              selected_task: 'Task 1: Cancelled detail different checks task',
              branch_name: 'codex/task-cancel-detail-different-checks',
              pr_url: 'https://github.com/example/repo/pull/513',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-different-checks.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '513': ['cancelled', 'cancelled'],
          },
          checkDetails: {
            '513': [
              [
                {
                  bucket: 'pass',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
                {
                  bucket: 'cancelled',
                  name: 'lint',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'cancelled',
                  workflow: 'CI Lint',
                },
              ],
              [
                {
                  bucket: 'pass',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI Tests',
                },
                {
                  bucket: 'cancelled',
                  name: 'lint',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:01:00Z',
                  state: 'cancelled',
                  workflow: 'CI Lint',
                },
              ],
            ],
          },
          headShas: {
            '513': ['sha-513'],
          },
          reviews: {
            '513': {
              'sha-513': [
                { status: 'clean', review_id: 9013 },
                { status: 'clean', review_id: 9013 },
              ],
            },
          },
          comments: {
            '513': {
              '9013': [],
            },
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
        '--checks-timeout-ms',
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

    assert.equal(result.status, 1, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail different checks task',
          selected_task: 'Task 1: Cancelled detail different checks task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-different-checks',
          pr_url: 'https://github.com/example/repo/pull/513',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not collapse distinct required checks that share workflow and name into one recovery group', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-colliding-identities-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Colliding required check identities task',
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
              selected_task: 'Task 1: Colliding required check identities task',
              branch_name: 'codex/task-colliding-required-check-identities',
              pr_url: 'https://github.com/example/repo/pull/515',
              merge_status: 'opened_not_merged',
              changed_files: ['src/colliding-required-check-identities.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '515': ['cancelled', 'cancelled'],
          },
          checkDetails: {
            '515': [
              [
                {
                  bucket: 'pass',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'macos',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Colliding required check identities task',
          selected_task: 'Task 1: Colliding required check identities task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-colliding-required-check-identities',
          pr_url: 'https://github.com/example/repo/pull/515',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails closed when detailed cancelled rows collapse below the bucket-level required check count', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-ambiguous-identity-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Ambiguous required check identity task',
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
              selected_task: 'Task 1: Ambiguous required check identity task',
              branch_name: 'codex/task-ambiguous-required-check-identity',
              pr_url: 'https://github.com/example/repo/pull/517',
              merge_status: 'opened_not_merged',
              changed_files: ['src/ambiguous-required-check-identity.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '517': [['pass', 'cancelled']],
          },
          checkDetails: {
            '517': [
              [
                {
                  bucket: 'pass',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '517': ['sha-517'],
          },
          checkRuns: {
            'sha-517': [
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                external_id: 'check-a',
              },
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                external_id: 'check-b',
              },
            ],
          },
          reviews: {
            '517': {
              'sha-517': [
                { status: 'clean', review_id: 9017 },
                { status: 'clean', review_id: 9017 },
              ],
            },
          },
          comments: {
            '517': {
              '9017': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Ambiguous required check identity task',
          selected_task: 'Task 1: Ambiguous required check identity task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-ambiguous-required-check-identity',
          pr_url: 'https://github.com/example/repo/pull/517',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not collapse distinct required checks that reuse the same external_id', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-shared-external-id-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Shared external id task',
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
              selected_task: 'Task 1: Shared external id task',
              branch_name: 'codex/task-shared-external-id',
              pr_url: 'https://github.com/example/repo/pull/516',
              merge_status: 'opened_not_merged',
              changed_files: ['src/shared-external-id.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '516': [['pass', 'cancelled']],
          },
          checkDetails: {
            '516': [
              [
                {
                  bucket: 'pass',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'macos',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '516': ['sha-516'],
          },
          checkRuns: {
            'sha-516': [
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                external_id: 'shared-check-suite',
              },
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                external_id: 'shared-check-suite',
              },
            ],
          },
          reviews: {
            '516': {
              'sha-516': [
                { status: 'clean', review_id: 9016 },
                { status: 'clean', review_id: 9016 },
              ],
            },
          },
          comments: {
            '516': {
              '9016': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Shared external id task',
          selected_task: 'Task 1: Shared external id task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-shared-external-id',
          pr_url: 'https://github.com/example/repo/pull/516',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc trusts a later rerun when identical visible check metadata only differs by run timing and URL', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-same-visible-rerun-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Same visible rerun task',
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
              selected_task: 'Task 1: Same visible rerun task',
              branch_name: 'codex/task-same-visible-rerun',
              pr_url: 'https://github.com/example/repo/pull/518',
              merge_status: 'opened_not_merged',
              changed_files: ['src/same-visible-rerun.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '518': [['pass', 'cancelled']],
          },
          checkDetails: {
            '518': [
              [
                {
                  bucket: 'pass',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '518': ['sha-518'],
          },
          checkRuns: {
            'sha-518': [
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                external_id: 'rerun-shared-check',
              },
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                external_id: 'rerun-shared-check',
              },
            ],
          },
          reviews: {
            '518': {
              'sha-518': [
                { status: 'clean', review_id: 9018 },
                { status: 'clean', review_id: 9018 },
              ],
            },
          },
          comments: {
            '518': {
              '9018': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Same visible rerun task',
          selected_task: 'Task 1: Same visible rerun task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-same-visible-rerun',
          pr_url: 'https://github.com/example/repo/pull/518',
          review_id: '9018',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails closed when identical visible cancelled checks lack stable check-run metadata', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-missing-metadata-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Missing rerun metadata task',
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
              selected_task: 'Task 1: Missing rerun metadata task',
              branch_name: 'codex/task-missing-rerun-metadata',
              pr_url: 'https://github.com/example/repo/pull/519',
              merge_status: 'opened_not_merged',
              changed_files: ['src/missing-rerun-metadata.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '519': [['pass', 'cancelled']],
          },
          checkDetails: {
            '519': [
              [
                {
                  bucket: 'pass',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '519': ['sha-519'],
          },
          reviews: {
            '519': {
              'sha-519': [
                { status: 'clean', review_id: 9019 },
                { status: 'clean', review_id: 9019 },
              ],
            },
          },
          comments: {
            '519': {
              '9019': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Missing rerun metadata task',
          selected_task: 'Task 1: Missing rerun metadata task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-missing-rerun-metadata',
          pr_url: 'https://github.com/example/repo/pull/519',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails closed when the detailed cancelled-check refresh drops a required row from the bucket view', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-missing-row-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Missing detailed row task',
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
              selected_task: 'Task 1: Missing detailed row task',
              branch_name: 'codex/task-missing-detailed-row',
              pr_url: 'https://github.com/example/repo/pull/522',
              merge_status: 'opened_not_merged',
              changed_files: ['src/missing-detailed-row.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '522': [['pass', 'cancelled']],
          },
          checkDetails: {
            '522': [
              [
                {
                  bucket: 'pass',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '522': ['sha-522'],
          },
          reviews: {
            '522': {
              'sha-522': [
                { status: 'clean', review_id: 9022 },
                { status: 'clean', review_id: 9022 },
              ],
            },
          },
          comments: {
            '522': {
              '9022': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Missing detailed row task',
          selected_task: 'Task 1: Missing detailed row task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-missing-detailed-row',
          pr_url: 'https://github.com/example/repo/pull/522',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc trusts paginated check-run metadata when rerun identity is split across API pages', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-paginated-metadata-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Paginated rerun metadata task',
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
              selected_task: 'Task 1: Paginated rerun metadata task',
              branch_name: 'codex/task-paginated-rerun-metadata',
              pr_url: 'https://github.com/example/repo/pull/520',
              merge_status: 'opened_not_merged',
              changed_files: ['src/paginated-rerun-metadata.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '520': [['pass', 'cancelled']],
          },
          checkDetails: {
            '520': [
              [
                {
                  bucket: 'pass',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'shared target',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '520': ['sha-520'],
          },
          checkRunPages: {
            'sha-520': [
              {
                total_count: 2,
                check_runs: [
                  {
                    app: { id: 15368 },
                    details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                    external_id: 'rerun-paginated-check',
                  },
                ],
              },
              {
                total_count: 2,
                check_runs: [
                  {
                    app: { id: 15368 },
                    details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                    external_id: 'rerun-paginated-check',
                  },
                ],
              },
            ],
          },
          reviews: {
            '520': {
              'sha-520': [
                { status: 'clean', review_id: 9020 },
                { status: 'clean', review_id: 9020 },
              ],
            },
          },
          comments: {
            '520': {
              '9020': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Paginated rerun metadata task',
          selected_task: 'Task 1: Paginated rerun metadata task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-paginated-rerun-metadata',
          pr_url: 'https://github.com/example/repo/pull/520',
          review_id: '9020',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc trusts reruns with stable external_id even when the displayed label changes between attempts', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-label-change-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Label change rerun task',
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
              selected_task: 'Task 1: Label change rerun task',
              branch_name: 'codex/task-label-change-rerun',
              pr_url: 'https://github.com/example/repo/pull/525',
              merge_status: 'opened_not_merged',
              changed_files: ['src/label-change-rerun.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '525': ['cancelled'],
          },
          checkDetails: {
            '525': [
              [
                {
                  bucket: 'pass',
                  description: 'linux (rerun)',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/3/job/3',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '525': ['sha-525'],
          },
          checkRuns: {
            'sha-525': [
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/3/job/3',
                external_id: 'rerun-label-change',
              },
              {
                app: { id: 15368 },
                details_url: 'https://github.com/example/repo/actions/runs/2/job/2',
                external_id: 'rerun-label-change',
              },
            ],
          },
          reviews: {
            '525': {
              'sha-525': [
                { status: 'clean', review_id: 9025 },
                { status: 'clean', review_id: 9025 },
              ],
            },
          },
          comments: {
            '525': {
              '9025': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Label change rerun task',
          selected_task: 'Task 1: Label change rerun task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-label-change-rerun',
          pr_url: 'https://github.com/example/repo/pull/525',
          review_id: '9025',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails closed when the detailed cancelled-check refresh returns an invalid shape', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-detail-invalid-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled detail invalid task',
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
              selected_task: 'Task 1: Cancelled detail invalid task',
              branch_name: 'codex/task-cancel-detail-invalid',
              pr_url: 'https://github.com/example/repo/pull/514',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancel-detail-invalid.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '514': ['cancelled'],
          },
          rawCheckDetails: {
            '514': [{}],
          },
          headShas: {
            '514': ['sha-514'],
          },
          reviews: {
            '514': {
              'sha-514': [{ status: 'clean', review_id: 9014 }],
            },
          },
          comments: {
            '514': {
              '9014': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled detail invalid task',
          selected_task: 'Task 1: Cancelled detail invalid task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancel-detail-invalid',
          pr_url: 'https://github.com/example/repo/pull/514',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc gives a new PR head its own cancelled-check grace poll', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-new-head-grace-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: New head cancelled grace task',
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
              selected_task: 'Task 1: New head cancelled grace task',
              branch_name: 'codex/task-new-head-cancelled-grace',
              pr_url: 'https://github.com/example/repo/pull/523',
              merge_status: 'opened_not_merged',
              changed_files: ['src/new-head-cancelled-grace.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '523': ['cancelled', 'cancelled', 'pass'],
          },
          checkDetails: {
            '523': [
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '523': ['sha-523-old', 'sha-523-new', 'sha-523-new'],
          },
          reviews: {
            '523': {
              'sha-523-new': [
                { status: 'clean', review_id: 9023 },
                { status: 'clean', review_id: 9023 },
              ],
            },
          },
          comments: {
            '523': {
              '9023': [],
            },
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
        '--max-check-polls',
        '3',
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: New head cancelled grace task',
          selected_task: 'Task 1: New head cancelled grace task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-new-head-cancelled-grace',
          pr_url: 'https://github.com/example/repo/pull/523',
          review_id: '9023',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc still fails fast when head SHA lookup is unavailable across repeated cancelled checks', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-null-head-sha-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Null head SHA cancelled grace task',
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
              selected_task: 'Task 1: Null head SHA cancelled grace task',
              branch_name: 'codex/task-null-head-sha-cancelled-grace',
              pr_url: 'https://github.com/example/repo/pull/524',
              merge_status: 'opened_not_merged',
              changed_files: ['src/null-head-sha-cancelled-grace.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '524': ['cancelled', 'cancelled', 'pass'],
          },
          checkDetails: {
            '524': [
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  name: 'tests',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
              ],
            ],
          },
          reviews: {
            '524': {
              'sha-524': [
                { status: 'clean', review_id: 9024 },
                { status: 'clean', review_id: 9024 },
              ],
            },
          },
          comments: {
            '524': {
              '9024': [],
            },
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
        '--max-check-polls',
        '3',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Null head SHA cancelled grace task',
          selected_task: 'Task 1: Null head SHA cancelled grace task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-null-head-sha-cancelled-grace',
          pr_url: 'https://github.com/example/repo/pull/524',
        },
      ],
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails fast when required checks stay cancelled across the grace poll', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-terminal-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Terminal cancelled check task',
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
              selected_task: 'Task 1: Terminal cancelled check task',
              branch_name: 'codex/task-terminal-cancelled-check',
              pr_url: 'https://github.com/example/repo/pull/508',
              merge_status: 'opened_not_merged',
              changed_files: ['src/terminal-cancelled-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '508': ['cancelled', 'cancelled'],
          },
          headShas: {
            '508': ['sha-508'],
          },
          reviews: {
            '508': {
              'sha-508': [{ status: 'clean', review_id: 9008 }],
            },
          },
          comments: {
            '508': {
              '9008': [],
            },
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
        '--checks-timeout-ms',
        '10',
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
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Terminal cancelled check task',
          selected_task: 'Task 1: Terminal cancelled check task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-terminal-cancelled-check',
          pr_url: 'https://github.com/example/repo/pull/508',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Terminal cancelled check task',
        'gh pr checks https://github.com/example/repo/pull/508 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/508 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/508 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-508/check-runs',
        'gh pr checks https://github.com/example/repo/pull/508 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/508 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/508 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-508/check-runs',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails instead of timing out when a cancelled required check is observed on the only poll', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-single-poll-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Single poll cancelled check task',
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
              selected_task: 'Task 1: Single poll cancelled check task',
              branch_name: 'codex/task-single-poll-cancelled-check',
              pr_url: 'https://github.com/example/repo/pull/510',
              merge_status: 'opened_not_merged',
              changed_files: ['src/single-poll-cancelled-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '510': ['cancel'],
          },
          headShas: {
            '510': ['sha-510'],
          },
          reviews: {
            '510': {
              'sha-510': [{ status: 'clean', review_id: 9010 }],
            },
          },
          comments: {
            '510': {
              '9010': [],
            },
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
        '--max-check-polls',
        '1',
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
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Single poll cancelled check task',
          selected_task: 'Task 1: Single poll cancelled check task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-single-poll-cancelled-check',
          pr_url: 'https://github.com/example/repo/pull/510',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Single poll cancelled check task',
        'gh pr checks https://github.com/example/repo/pull/510 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/510 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/510 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-510/check-runs',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc still fails fast when cancelled required checks persist alongside skipped checks', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-skipped-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Cancelled and skipped check task',
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
              selected_task: 'Task 1: Cancelled and skipped check task',
              branch_name: 'codex/task-cancelled-and-skipped-check',
              pr_url: 'https://github.com/example/repo/pull/511',
              merge_status: 'opened_not_merged',
              changed_files: ['src/cancelled-and-skipped-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '511': [
              ['cancelled', 'skipping'],
              ['cancelled', 'skipping'],
            ],
          },
          headShas: {
            '511': ['sha-511'],
          },
          reviews: {
            '511': {
              'sha-511': [{ status: 'clean', review_id: 9011 }],
            },
          },
          comments: {
            '511': {
              '9011': [],
            },
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
        '--checks-timeout-ms',
        '10',
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
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Cancelled and skipped check task',
          selected_task: 'Task 1: Cancelled and skipped check task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-cancelled-and-skipped-check',
          pr_url: 'https://github.com/example/repo/pull/511',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Cancelled and skipped check task',
        'gh pr checks https://github.com/example/repo/pull/511 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/511 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/511 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-511/check-runs',
        'gh pr checks https://github.com/example/repo/pull/511 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/511 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/511 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-511/check-runs',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc fails fast when the same cancelled required check persists while another required check changes', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-cancel-persistent-one-changing-other-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Persistent cancelled check task',
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
              selected_task: 'Task 1: Persistent cancelled check task',
              branch_name: 'codex/task-persistent-cancelled-check',
              pr_url: 'https://github.com/example/repo/pull/521',
              merge_status: 'opened_not_merged',
              changed_files: ['src/persistent-cancelled-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '521': [
              ['cancelled', 'pass'],
              ['cancelled', 'pass'],
              ['pass'],
            ],
          },
          checkDetails: {
            '521': [
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  name: 'tests',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
                {
                  bucket: 'pass',
                  description: 'macos',
                  event: 'pull_request',
                  link: 'https://github.com/example/repo/actions/runs/10/job/10',
                  name: 'tests',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
              ],
              [
                {
                  bucket: 'cancelled',
                  description: 'linux',
                  event: 'pull_request',
                  link: 'https://github.com/example/repo/actions/runs/2/job/2',
                  name: 'tests',
                  startedAt: '2026-03-21T00:02:00Z',
                  state: 'cancelled',
                  workflow: 'CI',
                },
                {
                  bucket: 'pass',
                  description: 'macos',
                  event: 'pull_request',
                  link: 'https://github.com/example/repo/actions/runs/11/job/11',
                  name: 'tests',
                  startedAt: '2026-03-21T00:03:00Z',
                  state: 'completed',
                  workflow: 'CI',
                },
              ],
            ],
          },
          headShas: {
            '521': ['sha-521'],
          },
          reviews: {
            '521': {
              'sha-521': [
                { status: 'clean', review_id: 9021 },
                { status: 'clean', review_id: 9021 },
              ],
            },
          },
          comments: {
            '521': {
              '9021': [],
            },
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
        '--max-check-polls',
        '3',
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

    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'failed',
      tasks: [
        {
          task_hint: 'Task 1: Persistent cancelled check task',
          selected_task: 'Task 1: Persistent cancelled check task',
          status: 'failed',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-persistent-cancelled-check',
          pr_url: 'https://github.com/example/repo/pull/521',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Persistent cancelled check task',
        'gh pr checks https://github.com/example/repo/pull/521 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/521 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/521 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-521/check-runs',
        'gh pr checks https://github.com/example/repo/pull/521 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/521 --required --json bucket,completedAt,description,event,name,link,startedAt,state,workflow',
        'gh pr view https://github.com/example/repo/pull/521 --json headRefOid --jq .headRefOid',
        'gh api --paginate --slurp repos/example/repo/commits/sha-521/check-runs',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc treats skipped required checks as pass-equivalent', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-skipping-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Skipped check task',
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
              selected_task: 'Task 1: Skipped check task',
              branch_name: 'codex/task-skipping-check',
              pr_url: 'https://github.com/example/repo/pull/502',
              merge_status: 'opened_not_merged',
              changed_files: ['src/skipping-check.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '502': ['skipping'],
          },
          headShas: {
            '502': ['sha-502'],
          },
          reviews: {
            '502': {
              'sha-502': [
                { status: 'clean', review_id: 9001 },
                { status: 'clean', review_id: 9001 },
              ],
            },
          },
          comments: {
            '502': {
              '9001': [],
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
    assert.deepEqual(result, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Skipped check task',
          selected_task: 'Task 1: Skipped check task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-skipping-check',
          pr_url: 'https://github.com/example/repo/pull/502',
          review_id: '9001',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['502']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Skipped check task',
        'gh pr checks https://github.com/example/repo/pull/502 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/502 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/502/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/502/comments',
        'gh api repos/example/repo/pulls/502/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/502/comments',
        'gh pr merge https://github.com/example/repo/pull/502 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc treats skipped required checks as pass-equivalent even when merge state is UNSTABLE', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-skipping-unstable-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Skipped unstable task',
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
              selected_task: 'Task 1: Skipped unstable task',
              branch_name: 'codex/task-skipping-unstable',
              pr_url: 'https://github.com/example/repo/pull/506',
              merge_status: 'opened_not_merged',
              changed_files: ['src/skipping-unstable.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '506': ['skipping'],
          },
          mergeables: {
            '506': ['MERGEABLE'],
          },
          mergeStateStatuses: {
            '506': ['UNSTABLE'],
          },
          headShas: {
            '506': ['sha-506'],
          },
          reviews: {
            '506': {
              'sha-506': [
                { status: 'clean', review_id: 9006 },
                { status: 'clean', review_id: 9006 },
              ],
            },
          },
          comments: {
            '506': {
              '9006': [],
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
    assert.deepEqual(result, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Skipped unstable task',
          selected_task: 'Task 1: Skipped unstable task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-skipping-unstable',
          pr_url: 'https://github.com/example/repo/pull/506',
          review_id: '9006',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['506']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Skipped unstable task',
        'gh pr checks https://github.com/example/repo/pull/506 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/506 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/506/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/506/comments',
        'gh api repos/example/repo/pulls/506/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/506/comments',
        'gh pr merge https://github.com/example/repo/pull/506 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc keeps waiting when required checks are still pending', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-skipping-unsafe-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Skipped but unsafe task',
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
              selected_task: 'Task 1: Skipped but unsafe task',
              branch_name: 'codex/task-skipping-unsafe',
              pr_url: 'https://github.com/example/repo/pull/505',
              merge_status: 'opened_not_merged',
              changed_files: ['src/skipping-unsafe.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '505': ['pending', 'pending'],
          },
          headShas: {
            '505': ['sha-505'],
          },
          reviews: {
            '505': {
              'sha-505': [{ status: 'pending' }],
            },
          },
          comments: {},
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
        '--max-check-polls',
        '2',
        '--max-review-polls',
        '1',
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
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'manual_review_required',
      tasks: [
        {
          task_hint: 'Task 1: Skipped but unsafe task',
          selected_task: 'Task 1: Skipped but unsafe task',
          status: 'manual_review_required',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-skipping-unsafe',
          pr_url: 'https://github.com/example/repo/pull/505',
          pending_gate: 'required_checks',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, []);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Skipped but unsafe task',
        'gh pr checks https://github.com/example/repo/pull/505 --required --json bucket',
        'gh pr checks https://github.com/example/repo/pull/505 --required --json bucket',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc treats skipped required checks as pass-equivalent even when merge metadata is absent', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-skipping-merge-safe-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Skipped but unconfirmed task',
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
              selected_task: 'Task 1: Skipped but unconfirmed task',
              branch_name: 'codex/task-skipping-unconfirmed',
              pr_url: 'https://github.com/example/repo/pull/509',
              merge_status: 'opened_not_merged',
              changed_files: ['src/skipping-unconfirmed.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '509': ['skipping'],
          },
          headShas: {
            '509': ['sha-509'],
          },
          reviews: {
            '509': {
              'sha-509': [
                { status: 'clean', review_id: 9109 },
                { status: 'clean', review_id: 9109 },
              ],
            },
          },
          comments: {
            '509': {
              '9109': [],
            },
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
        '--max-check-polls',
        '1',
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

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: Skipped but unconfirmed task',
          selected_task: 'Task 1: Skipped but unconfirmed task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-skipping-unconfirmed',
          pr_url: 'https://github.com/example/repo/pull/509',
          review_id: '9109',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['509']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Skipped but unconfirmed task',
        'gh pr checks https://github.com/example/repo/pull/509 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/509 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/509/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/509/comments',
        'gh api repos/example/repo/pulls/509/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/509/comments',
        'gh pr merge https://github.com/example/repo/pull/509 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc advances skipped required checks to the Codex review gate even when PR merge metadata is blocked', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-check-skipping-review-blocked-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Review blocked but mergeable',
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
              selected_task: 'Task 1: Review blocked but mergeable',
              branch_name: 'codex/task-review-blocked',
              pr_url: 'https://github.com/example/repo/pull/507',
              merge_status: 'opened_not_merged',
              changed_files: ['src/review-blocked.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '507': ['skipping'],
          },
          mergeables: {
            '507': ['MERGEABLE'],
          },
          mergeStateStatuses: {
            '507': ['BLOCKED'],
          },
          headShas: {
            '507': ['sha-507'],
          },
          reviews: {
            '507': {
              'sha-507': [{ status: 'pending' }, { status: 'pending' }],
            },
          },
          comments: {},
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
        '--max-review-polls',
        '1',
        '--review-timeout-ms',
        '2',
        '--max-check-polls',
        '1',
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
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'manual_review_required',
      tasks: [
        {
          task_hint: 'Task 1: Review blocked but mergeable',
          selected_task: 'Task 1: Review blocked but mergeable',
          status: 'manual_review_required',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-review-blocked',
          pr_url: 'https://github.com/example/repo/pull/507',
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
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Review blocked but mergeable',
        'gh pr checks https://github.com/example/repo/pull/507 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/507 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/507/reviews',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc confirms a clean review when max review polls is 1', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-single-review-poll-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: One poll task',
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
              selected_task: 'Task 1: One poll task',
              branch_name: 'codex/task-one-poll',
              pr_url: 'https://github.com/example/repo/pull/503',
              merge_status: 'opened_not_merged',
              changed_files: ['src/one-poll.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '503': ['pass'],
          },
          headShas: {
            '503': ['sha-503'],
          },
          reviews: {
            '503': {
              'sha-503': [
                { status: 'clean', review_id: 9101 },
                { status: 'clean', review_id: 9101 },
              ],
            },
          },
          comments: {
            '503': {
              '9101': [],
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
        '--max-review-polls',
        '1',
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
    assert.deepEqual(result, {
      status: 'completed',
      tasks: [
        {
          task_hint: 'Task 1: One poll task',
          selected_task: 'Task 1: One poll task',
          status: 'merged',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-one-poll',
          pr_url: 'https://github.com/example/repo/pull/503',
          review_id: '9101',
        },
      ],
    });

    const finalState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(finalState.merged, ['503']);
    assert.deepEqual(
      finalState.commands.map((entry) => `${entry.bin} ${entry.argv.join(' ')}`),
      [
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: One poll task',
        'gh pr checks https://github.com/example/repo/pull/503 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/503 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/503/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/503/comments',
        'gh api repos/example/repo/pulls/503/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/503/comments',
        'gh pr merge https://github.com/example/repo/pull/503 --merge --delete-branch',
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('run-plan-doc does not bypass the clean-review debounce on the final poll when more than one review poll is configured', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'plan-runner-final-review-debounce-'));
  const planPath = path.join(tempRoot, 'plan.md');
  const statePath = path.join(tempRoot, 'state.json');

  try {
    await writeFile(
      planPath,
      [
        '# Example Plan',
        '',
        '### Task 1: Final poll debounce task',
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
              selected_task: 'Task 1: Final poll debounce task',
              branch_name: 'codex/task-final-poll-debounce',
              pr_url: 'https://github.com/example/repo/pull/504',
              merge_status: 'opened_not_merged',
              changed_files: ['src/final-poll-debounce.ts'],
              validation_commands: ['npm run build'],
            },
          ],
          checks: {
            '504': ['pass'],
          },
          headShas: {
            '504': ['sha-504'],
          },
          reviews: {
            '504': {
              'sha-504': [
                { status: 'pending' },
                { status: 'clean', review_id: 9201 },
                { status: 'clean', review_id: 9201 },
              ],
            },
          },
          comments: {
            '504': {
              '9201': [],
            },
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
        '--max-review-polls',
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
          task_hint: 'Task 1: Final poll debounce task',
          selected_task: 'Task 1: Final poll debounce task',
          status: 'manual_review_required',
          attempts: 1,
          repaired: false,
          branch_name: 'codex/task-final-poll-debounce',
          pr_url: 'https://github.com/example/repo/pull/504',
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
        'goose run --recipe .goose/recipes/execute-next-plan-task.yaml --quiet --no-session --output-format json --system Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging. --params repo_path=' + projectRoot + ' --params plan_path=' + planPath + ' --params base_branch=main --params task_hint=Task 1: Final poll debounce task',
        'gh pr checks https://github.com/example/repo/pull/504 --required --json bucket',
        'gh pr view https://github.com/example/repo/pull/504 --json headRefOid --jq .headRefOid',
        'gh api repos/example/repo/pulls/504/reviews',
        'gh api repos/example/repo/pulls/504/reviews',
        'gh api --paginate --slurp repos/example/repo/pulls/504/comments',
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
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
