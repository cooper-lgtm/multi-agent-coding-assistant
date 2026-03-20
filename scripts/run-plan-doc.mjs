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
      checksTimeoutMs: options.checksTimeoutMs,
      reviewTimeoutMs: options.reviewTimeoutMs,
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
    checksTimeoutMs: 30 * 60_000,
    reviewTimeoutMs: 30 * 60_000,
    maxCheckPolls: undefined,
    maxReviewPolls: undefined,
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
      case '--checks-timeout-ms':
        options.checksTimeoutMs = Number(next);
        index += 1;
        break;
      case '--review-timeout-ms':
        options.reviewTimeoutMs = Number(next);
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
  const cleanReviewObservationByHead = new Map();

  return {
    executeTaskSlice: async ({ taskHint, repoPath, planPath, baseBranch, priorReview }) => {
      const gooseArgs = [
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
      ];

      if (priorReview && priorReview.findings.length > 0) {
        gooseArgs.push('--params', `prior_review=${JSON.stringify(priorReview.findings)}`);
      }

      const stdout = await runCommand(
        'goose',
        gooseArgs,
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

      if (
        checks.some((check) => {
          return ['fail', 'cancel', 'cancelled'].includes(check.bucket);
        })
      ) {
        return 'fail';
      }

      return checks.every((check) => ['pass', 'skipping', 'skipped'].includes(check.bucket)) ? 'pass' : 'pending';
    },
    getPullRequestHeadSha: async ({ prUrl }) => {
      return runCommand(
        'gh',
        ['pr', 'view', prUrl, '--json', 'headRefOid', '--jq', '.headRefOid'],
        { cwd },
      );
    },
    getCodexReviewState: async ({ prUrl, headSha }) => {
      const observationKey = `${prUrl}::${headSha}`;
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
        cleanReviewObservationByHead.delete(observationKey);
        return { status: 'pending', findings: [] };
      }

      const commentsResponse = JSON.parse(
        await runCommand(
          'gh',
          ['api', '--paginate', '--slurp', `repos/${owner}/${repo}/pulls/${number}/comments`],
          { cwd },
        ),
      );
      const comments = flattenPaginatedComments(commentsResponse);

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

      const reviewId = String(latestReview.id);
      if (findings.length === 0) {
        const previousObservation = cleanReviewObservationByHead.get(observationKey);
        cleanReviewObservationByHead.set(observationKey, reviewId);

        if (previousObservation !== reviewId) {
          return {
            status: 'pending',
            review_id: reviewId,
            findings: [],
          };
        }
      } else {
        cleanReviewObservationByHead.delete(observationKey);
      }

      return {
        status: findings.length > 0 ? 'findings' : 'clean',
        review_id: reviewId,
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

function flattenPaginatedComments(commentsResponse) {
  if (!Array.isArray(commentsResponse)) {
    return [];
  }

  if (commentsResponse.length === 0) {
    return [];
  }

  if (Array.isArray(commentsResponse[0])) {
    return commentsResponse.flat();
  }

  return commentsResponse;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
