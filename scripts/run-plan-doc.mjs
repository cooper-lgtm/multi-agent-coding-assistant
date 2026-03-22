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
  const consecutiveCancelledCheckObservationsByPr = new Map();

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
        consecutiveCancelledCheckObservationsByPr.delete(prUrl);
        return 'pending';
      }

      const passBuckets = ['pass'];
      const skippedBuckets = ['skipping', 'skipped'];
      const cancelledBuckets = ['cancel', 'cancelled'];
      const checkSummary = summarizeCheckBuckets(checks, {
        passBuckets,
        skippedBuckets,
        cancelledBuckets,
      });

      if (checkSummary.hasFail) {
        consecutiveCancelledCheckObservationsByPr.delete(prUrl);
        return 'fail';
      }

      if (checkSummary.allPass) {
        consecutiveCancelledCheckObservationsByPr.delete(prUrl);
        return 'pass';
      }

      if (checkSummary.hasCancelledCheck && !checkSummary.hasActiveCheck) {
        const { checks: detailedChecks, headSha: detailedChecksHeadSha } = await readDetailedChecks({ prUrl, cwd });
        if (detailedChecks.length < checks.length) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'fail';
        }

        const latestDetailedChecks = collapseDetailedChecksToLatestRequiredRuns(detailedChecks, {
          allowExternalIdentityFallback: detailedChecks.length > checks.length,
          allowVisibleIdentityFallback: detailedChecks.length > checks.length,
        });
        const detailedCheckSummary = summarizeCheckBuckets(latestDetailedChecks, {
          passBuckets,
          skippedBuckets,
          cancelledBuckets,
        });

        if (detailedCheckSummary.hasFail) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'fail';
        }

        if (detailedCheckSummary.allPass) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'pass';
        }

        if (detailedCheckSummary.allPassOrSkipped) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'pass';
        }

        if (!detailedCheckSummary.hasCancelledCheck || detailedCheckSummary.hasActiveCheck) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'pending';
        }

        const cancelledObservationKeys = buildCancelledCheckObservationKeys(latestDetailedChecks);
        const previousCancelledObservationState = consecutiveCancelledCheckObservationsByPr.get(prUrl);
        const previousCancelledObservationCounts = previousCancelledObservationState
          && previousCancelledObservationState.headSha === detailedChecksHeadSha
          ? previousCancelledObservationState.counts
          : new Map();
        const nextCancelledObservationCounts = new Map(
          cancelledObservationKeys.map((observationKey) => {
            return [observationKey, (previousCancelledObservationCounts.get(observationKey) ?? 0) + 1];
          }),
        );

        if ([...nextCancelledObservationCounts.values()].some((count) => count >= 2)) {
          consecutiveCancelledCheckObservationsByPr.delete(prUrl);
          return 'fail';
        }

        consecutiveCancelledCheckObservationsByPr.set(prUrl, {
          headSha: detailedChecksHeadSha ?? null,
          counts: nextCancelledObservationCounts,
        });
        return 'cancelled';
      }

      if (checkSummary.allPassOrSkipped) {
        consecutiveCancelledCheckObservationsByPr.delete(prUrl);
        return 'pass';
      }

      consecutiveCancelledCheckObservationsByPr.delete(prUrl);
      return 'pending';
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

async function readDetailedChecks({ prUrl, cwd }) {
  const stdout = await runCommand(
    'gh',
    ['pr', 'checks', prUrl, '--required', '--json', 'bucket,completedAt,description,event,name,link,startedAt,state,workflow'],
    { cwd },
  );

  const checks = JSON.parse(stdout);
  if (!Array.isArray(checks)) {
    return { checks: [], headSha: null };
  }

  const { headSha, metadataByDetailsUrl } = await readCheckRunMetadataByDetailsUrl({ prUrl, cwd });
  return {
    headSha,
    checks: checks.map((check) => {
      const metadata = typeof check?.link === 'string' ? metadataByDetailsUrl.get(check.link) : null;
      return {
        ...check,
        appId: metadata?.appId ?? null,
        externalId: metadata?.externalId ?? null,
      };
    }),
  };
}

async function readCheckRunMetadataByDetailsUrl({ prUrl, cwd }) {
  try {
    const headSha = await runCommand(
      'gh',
      ['pr', 'view', prUrl, '--json', 'headRefOid', '--jq', '.headRefOid'],
      { cwd },
    );
    if (!headSha) {
      return {
        headSha: null,
        metadataByDetailsUrl: new Map(),
      };
    }

    const { owner, repo } = parseGitHubPrUrl(prUrl);
    const stdout = await runCommand(
      'gh',
      ['api', '--paginate', '--slurp', `repos/${owner}/${repo}/commits/${headSha}/check-runs`],
      { cwd },
    );
    const payload = JSON.parse(stdout);
    const payloadPages = Array.isArray(payload) ? payload : [payload];
    const checkRuns = payloadPages.flatMap((page) => {
      return Array.isArray(page?.check_runs) ? page.check_runs : [];
    });

    return {
      headSha,
      metadataByDetailsUrl: new Map(
        checkRuns
          .filter((checkRun) => typeof checkRun?.details_url === 'string' && checkRun.details_url.length > 0)
          .map((checkRun) => [
            checkRun.details_url,
            {
              appId: checkRun.app?.id ?? null,
              externalId: checkRun.external_id ?? null,
            },
          ]),
      ),
    };
  } catch {
    return {
      headSha: null,
      metadataByDetailsUrl: new Map(),
    };
  }
}

function collapseDetailedChecksToLatestRequiredRuns(checks, options = {}) {
  const collapsedChecks = [];
  const groupedChecks = groupDetailedChecksByVisibleIdentity(checks, options);

  for (const group of groupedChecks.values()) {
    if (group.length <= 1 || !isClearRerunSequence(group.map((entry) => entry.check))) {
      collapsedChecks.push(...group);
      continue;
    }

    const latestEntry = [...group].sort((left, right) => {
      return compareCheckRecency(left.check, left.index, right.check, right.index);
    }).at(-1);
    if (latestEntry) {
      collapsedChecks.push(latestEntry);
    }
  }

  return collapsedChecks
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.check);
}

function groupDetailedChecksByVisibleIdentity(checks, options = {}) {
  const groups = new Map();

  checks.forEach((check, index) => {
    const identityKey = buildRequiredCheckVisibleIdentityKey(check, index, options);
    const existing = groups.get(identityKey);
    if (existing) {
      existing.push({ check, index });
      return;
    }

    groups.set(identityKey, [{ check, index }]);
  });

  return groups;
}

function buildRequiredCheckVisibleIdentityKey(check, index, options = {}) {
  const stableRerunIdentity = buildStableRequiredCheckRerunIdentity(check, options);
  if (stableRerunIdentity !== null) {
    return JSON.stringify(stableRerunIdentity);
  }

  if (options.allowVisibleIdentityFallback) {
    const visibleIdentity = buildVisibleRequiredCheckIdentity(check);
    const hasVisibleIdentity = Object.values(visibleIdentity).some((value) => {
      return typeof value === 'string' ? value.trim().length > 0 : value !== null;
    });

    if (hasVisibleIdentity) {
      return JSON.stringify(visibleIdentity);
    }
  }

  return JSON.stringify({ fallbackIndex: index });
}

function buildVisibleRequiredCheckIdentity(check) {
  return {
    description: check?.description ?? null,
    event: check?.event ?? null,
    name: check?.name ?? null,
    workflow: check?.workflow ?? null,
  };
}

function buildStableRequiredCheckRerunIdentity(check, options = {}) {
  const appId = check?.appId ?? null;
  const externalId = typeof check?.externalId === 'string' ? check.externalId.trim() : '';

  if (appId === null || externalId.length === 0) {
    return null;
  }

  const identity = {
    appId,
    externalId,
  };

  if (options.allowExternalIdentityFallback) {
    return identity;
  }

  return {
    ...identity,
    ...buildVisibleRequiredCheckIdentity(check),
  };
}

function isClearRerunSequence(group) {
  const orderedChecks = [...group].sort((left, right) => compareCheckRecency(left, 0, right, 0));
  if (orderedChecks.length <= 1) {
    return false;
  }

  for (let index = 1; index < orderedChecks.length; index += 1) {
    const previous = orderedChecks[index - 1];
    const current = orderedChecks[index];
    const previousStartedAt = parseTimestamp(previous?.startedAt);
    const currentStartedAt = parseTimestamp(current?.startedAt);

    if (Number.isFinite(previousStartedAt) && Number.isFinite(currentStartedAt)) {
      if (currentStartedAt <= previousStartedAt) {
        return false;
      }
      continue;
    }

    const previousRunOrdinal = extractGitHubRunOrdinal(previous?.link);
    const currentRunOrdinal = extractGitHubRunOrdinal(current?.link);
    if (Number.isFinite(previousRunOrdinal) && Number.isFinite(currentRunOrdinal) && currentRunOrdinal > previousRunOrdinal) {
      continue;
    }

    return false;
  }

  return true;
}

function compareCheckRecency(leftCheck, leftIndex, rightCheck, rightIndex) {
  const startedComparison = compareNullableTimestamps(leftCheck?.startedAt, rightCheck?.startedAt);
  if (startedComparison !== 0) {
    return startedComparison;
  }

  const runOrdinalComparison = compareNullableNumbers(
    extractGitHubRunOrdinal(leftCheck?.link),
    extractGitHubRunOrdinal(rightCheck?.link),
  );
  if (runOrdinalComparison !== 0) {
    return runOrdinalComparison;
  }

  const completedComparison = compareNullableTimestamps(leftCheck?.completedAt, rightCheck?.completedAt);
  if (completedComparison !== 0) {
    return completedComparison;
  }

  return leftIndex - rightIndex;
}

function compareNullableTimestamps(leftValue, rightValue) {
  return compareNullableNumbers(parseTimestamp(leftValue), parseTimestamp(rightValue));
}

function compareNullableNumbers(leftValue, rightValue) {
  const leftIsFinite = Number.isFinite(leftValue);
  const rightIsFinite = Number.isFinite(rightValue);

  if (!leftIsFinite && !rightIsFinite) {
    return 0;
  }

  if (!leftIsFinite) {
    return -1;
  }

  if (!rightIsFinite) {
    return 1;
  }

  return leftValue - rightValue;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractGitHubRunOrdinal(link) {
  if (typeof link !== 'string' || link.length === 0) {
    return null;
  }

  const match = link.match(/\/runs\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

function buildCancelledCheckObservationKeys(checks) {
  return checks
    .map((check) => {
      if (!['cancel', 'cancelled'].includes(check?.bucket)) {
        return null;
      }

      return buildCancelledCheckObservationKey(check);
    })
    .filter(Boolean)
    .sort();
}

function buildCancelledCheckObservationKey(check) {
  return JSON.stringify({
    requiredCheckIdentity: buildStableRequiredCheckRerunIdentity(check) ?? {
      description: check?.description ?? null,
      event: check?.event ?? null,
      name: check?.name ?? null,
      workflow: check?.workflow ?? null,
    },
    completedAt: check?.completedAt ?? null,
    link: check?.link ?? null,
    startedAt: check?.startedAt ?? null,
    state: check?.state ?? null,
  });
}

function summarizeCheckBuckets(checks, bucketGroups) {
  const hasChecks = checks.length > 0;
  return {
    hasFail: checks.some((check) => ['fail'].includes(check.bucket)),
    allPass: hasChecks && checks.every((check) => bucketGroups.passBuckets.includes(check.bucket)),
    hasCancelledCheck: checks.some((check) => bucketGroups.cancelledBuckets.includes(check.bucket)),
    hasActiveCheck: checks.some((check) => {
      return !bucketGroups.passBuckets.includes(check.bucket)
        && !bucketGroups.cancelledBuckets.includes(check.bucket)
        && !bucketGroups.skippedBuckets.includes(check.bucket);
    }),
    allPassOrSkipped: hasChecks && checks.every((check) => {
      return bucketGroups.passBuckets.includes(check.bucket) || bucketGroups.skippedBuckets.includes(check.bucket);
    }),
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
