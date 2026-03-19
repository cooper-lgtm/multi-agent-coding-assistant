#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runPlanTaskSequence } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const NO_MERGE_SYSTEM_PROMPT =
  'Do not merge pull requests in this run. Stop after creating or updating the task-sized PR so the outer plan runner can wait for required checks and Codex review before merging.';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const taskHints = options.tasks.length > 0
    ? options.tasks
    : extractPlanTaskHints(await readFile(options.planPath, 'utf8'));

  if (taskHints.length === 0) {
    throw new Error(`No task headings found in ${options.planPath}`);
  }

  const result = await runPlanTaskSequence(
    {
      repoPath: options.repoPath,
      planPath: options.planPath,
      baseBranch: options.baseBranch,
      taskHints,
      pollIntervalMs: options.pollIntervalMs,
      maxCheckPolls: options.maxCheckPolls,
      maxReviewPolls: options.maxReviewPolls,
    },
    createShellDependencies({ cwd: options.repoPath }),
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.status !== 'completed') {
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const options = {
    repoPath: '',
    planPath: '',
    baseBranch: 'main',
    pollIntervalMs: 30_000,
    maxCheckPolls: 60,
    maxReviewPolls: 60,
    tasks: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];

    switch (current) {
      case '--repo-path':
        options.repoPath = next;
        index += 1;
        break;
      case '--plan-path':
        options.planPath = next;
        index += 1;
        break;
      case '--base-branch':
        options.baseBranch = next;
        index += 1;
        break;
      case '--poll-interval-ms':
        options.pollIntervalMs = Number(next);
        index += 1;
        break;
      case '--max-check-polls':
        options.maxCheckPolls = Number(next);
        index += 1;
        break;
      case '--max-review-polls':
        options.maxReviewPolls = Number(next);
        index += 1;
        break;
      case '--task':
        options.tasks.push(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  if (!options.repoPath || !options.planPath) {
    throw new Error('--repo-path and --plan-path are required');
  }

  return options;
}

function extractPlanTaskHints(markdown) {
  return [...markdown.matchAll(/^### (Task \d+: .+)$/gm)].map((match) => match[1]);
}

function createShellDependencies({ cwd }) {
  return {
    executeTaskSlice: async ({ taskHint, repoPath, planPath, baseBranch }) => {
      const stdout = await runCommand(
        'goose',
        [
          'run',
          '--recipe',
          '.goose/recipes/execute-next-plan-task.yaml',
          '--quiet',
          '--no-session',
          '--output-format',
          'json',
          '--system',
          NO_MERGE_SYSTEM_PROMPT,
          '--params',
          `repo_path=${repoPath}`,
          '--params',
          `plan_path=${planPath}`,
          '--params',
          `base_branch=${baseBranch}`,
          '--params',
          `task_hint=${taskHint}`,
        ],
        { cwd },
      );

      return JSON.parse(stdout);
    },
    getRequiredCheckStatus: async ({ prUrl }) => {
      const stdout = await runCommand(
        'gh',
        ['pr', 'checks', prUrl, '--required', '--json', 'bucket'],
        { cwd },
      );

      const checks = JSON.parse(stdout);
      if (!Array.isArray(checks) || checks.length === 0) {
        return 'pending';
      }

      if (checks.some((check) => check.bucket === 'fail')) {
        return 'fail';
      }

      return checks.every((check) => check.bucket === 'pass') ? 'pass' : 'pending';
    },
    getPullRequestHeadSha: async ({ prUrl }) => {
      return runCommand(
        'gh',
        ['pr', 'view', prUrl, '--json', 'headRefOid', '--jq', '.headRefOid'],
        { cwd },
      );
    },
    getCodexReviewState: async ({ prUrl, headSha }) => {
      const { owner, repo, number } = parseGitHubPrUrl(prUrl);
      const reviews = JSON.parse(
        await runCommand(
          'gh',
          ['api', `repos/${owner}/${repo}/pulls/${number}/reviews`],
          { cwd },
        ),
      );

      const matchingReviews = reviews.filter((review) => {
        return review.user?.login === 'chatgpt-codex-connector[bot]' && review.commit_id === headSha;
      });

      const latestReview = matchingReviews.at(-1);
      if (!latestReview) {
        return { status: 'pending', findings: [] };
      }

      const comments = JSON.parse(
        await runCommand(
          'gh',
          ['api', `repos/${owner}/${repo}/pulls/${number}/comments`],
          { cwd },
        ),
      );

      const findings = comments
        .filter((comment) => {
          return (
            comment.user?.login === 'chatgpt-codex-connector[bot]' &&
            comment.pull_request_review_id === latestReview.id
          );
        })
        .map((comment) => ({
          path: comment.path,
          body: comment.body,
        }));

      return {
        status: findings.length > 0 ? 'findings' : 'clean',
        review_id: String(latestReview.id),
        findings,
      };
    },
    mergePullRequest: async ({ prUrl }) => {
      await runCommand(
        'gh',
        ['pr', 'merge', prUrl, '--merge', '--delete-branch'],
        { cwd },
      );
    },
    sleep: async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}

async function runCommand(command, args, options) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
  });

  return stdout.trim();
}

function parseGitHubPrUrl(prUrl) {
  const parsed = new URL(prUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4 || segments[2] !== 'pull') {
    throw new Error(`Unsupported pull request URL: ${prUrl}`);
  }

  return {
    owner: segments[0],
    repo: segments[1],
    number: segments[3],
  };
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
