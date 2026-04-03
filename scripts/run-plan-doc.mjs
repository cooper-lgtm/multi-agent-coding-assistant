#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePlanDocument, runPlanTaskSequence } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const DEFAULT_INSTALL_GIT_HOOKS_SCRIPT_PATH = fileURLToPath(new URL('./install-git-hooks.mjs', import.meta.url));
const DEFAULT_LOCAL_REVIEW_RUNNER_PATH = fileURLToPath(new URL('./run-local-codex-review.mjs', import.meta.url));
const LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const LOCAL_REVIEW_CLI_TIMEOUT_GRACE_MS = 5_000;
const EXECUTE_NEXT_PLAN_TASK_RECIPE_PATH = '.goose/recipes/execute-next-plan-task.yaml';
const REQUIRED_RECIPE_NO_MERGE_GUARDS = {
  instructions:
    'Do not merge the PR in this recipe; required-check polling and merge decisions belong to the outer plan runner',
  prompt:
    'Finish after one task-sized PR has had any required context artifacts refreshed on-branch, been validated, and been opened or updated for outer-loop checks. Do not merge. The outer plan runner will wait only on required GitHub checks before merging.',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const parsedPlan = parsePlanDocument(await readFile(options.planPath, 'utf8'));
  const taskHints = options.tasks.length > 0
    ? options.tasks
    : parsedPlan.task_hints;

  if (taskHints.length === 0) {
    throw new Error(`No task headings found in ${options.planPath}`);
  }

  const result = await runPlanTaskSequence(
    {
      repoPath: options.repoPath,
      planPath: options.planPath,
      baseBranch: options.baseBranch,
      taskHints,
      planDesignDocPath: parsedPlan.design_doc_path,
      taskDocsByHint: parsedPlan.task_docs_by_hint,
      pollIntervalMs: options.pollIntervalMs,
      checksTimeoutMs: options.checksTimeoutMs,
      maxCheckPolls: options.maxCheckPolls,
    },
    createShellDependencies({
      cwd: options.repoPath,
      reviewTimeoutMs: options.reviewTimeoutMs,
    }),
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
        throw new Error('--max-review-polls is no longer supported because local review is now a synchronous pre-push gate.');
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

function createShellDependencies({ cwd, reviewTimeoutMs }) {
  const consecutiveCancelledCheckObservationsByPr = new Map();

  return {
    executeTaskSlice: async ({
      taskHint,
      repoPath,
      planPath,
      baseBranch,
      attempt: _attempt,
      designDocPath,
      taskDocPaths = [],
    }) => {
      await ensureRecipeRetainsNoMergeGuards(repoPath);
      await ensureGitHooksInstalled(repoPath);

      const gooseArgs = [
        'run',
        '--recipe',
        EXECUTE_NEXT_PLAN_TASK_RECIPE_PATH,
        '--quiet',
        '--no-session',
        '--output-format',
        'json',
        '--params',
        `repo_path=${repoPath}`,
        '--params',
        `plan_path=${planPath}`,
        '--params',
        `base_branch=${baseBranch}`,
        '--params',
        `task_hint=${taskHint}`,
      ];

      if (designDocPath) {
        gooseArgs.push('--params', `design_doc_path=${designDocPath}`);
      }

      if (taskDocPaths.length > 0) {
        gooseArgs.push('--params', `task_doc_paths_json=${JSON.stringify(taskDocPaths)}`);
      }

      const stdout = await runCommand(
        'goose',
        gooseArgs,
        {
          cwd,
          env: buildLocalReviewEnv(reviewTimeoutMs),
        },
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

async function ensureRecipeRetainsNoMergeGuards(repoPath) {
  const recipePath = path.join(repoPath, EXECUTE_NEXT_PLAN_TASK_RECIPE_PATH);
  const recipeSource = await readFile(recipePath, 'utf8');
  const instructionsBlock = extractRecipeLiteralBlock(recipeSource, 'instructions');
  const promptBlock = extractRecipeLiteralBlock(recipeSource, 'prompt');

  if (!instructionsBlock.includes(REQUIRED_RECIPE_NO_MERGE_GUARDS.instructions)) {
    throw new Error(
      `Recipe ${EXECUTE_NEXT_PLAN_TASK_RECIPE_PATH} is missing the required no-merge guard in instructions and cannot be used by run-plan-doc.`,
    );
  }

  if (!promptBlock.includes(REQUIRED_RECIPE_NO_MERGE_GUARDS.prompt)) {
    throw new Error(
      `Recipe ${EXECUTE_NEXT_PLAN_TASK_RECIPE_PATH} is missing the required no-merge guard in prompt and cannot be used by run-plan-doc.`,
    );
  }
}

function extractRecipeLiteralBlock(recipeSource, key) {
  const lines = recipeSource.split(/\r?\n/u);
  const marker = `${key}: |`;
  const startIndex = lines.findIndex((line) => line.trim() === marker);

  if (startIndex === -1) {
    return '';
  }

  const blockLines = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('  ')) {
      blockLines.push(line.slice(2));
      continue;
    }

    if (!line.trim()) {
      blockLines.push('');
      continue;
    }

    break;
  }

  return blockLines.join('\n');
}

async function ensureGitHooksInstalled(repoPath) {
  await runCommand(
    process.execPath,
    [process.env.PLAN_RUNNER_INSTALL_HOOKS_SCRIPT_PATH?.trim() || DEFAULT_INSTALL_GIT_HOOKS_SCRIPT_PATH, '--repo-path', repoPath],
    { cwd: repoPath },
  );
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
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
  });

  return stdout.trim();
}

function buildLocalReviewCommand({ baseRef, headSha, changedFiles = [], taskHint = null }) {
  const runnerPath = process.env.PLAN_RUNNER_LOCAL_REVIEW_RUNNER_PATH?.trim() || DEFAULT_LOCAL_REVIEW_RUNNER_PATH;
  const argv = [
    runnerPath,
    '--head-range',
    baseRef,
    headSha,
  ];

  for (const changedFile of changedFiles) {
    argv.push('--changed-file', changedFile);
  }

  if (taskHint) {
    argv.push('--task-hint', taskHint);
  }

  argv.push('--output-format', 'json');

  return {
    bin: 'node',
    argv,
  };
}

function buildLocalReviewEnv(reviewTimeoutMs) {
  const env = { ...process.env };
  if (typeof reviewTimeoutMs === 'number' && Number.isFinite(reviewTimeoutMs) && reviewTimeoutMs > 0) {
    env.LOCAL_CODEX_REVIEW_TIMEOUT_MS = String(reviewTimeoutMs);
  }

  return env;
}

async function runLocalReviewCli({ repoPath, baseRef, headSha, changedFiles, taskHint, reviewTimeoutMs }) {
  const command = buildLocalReviewCommand({ baseRef, headSha, changedFiles, taskHint });
  let stdout = '';
  const outerTimeoutMs = (
    typeof reviewTimeoutMs === 'number' &&
    Number.isFinite(reviewTimeoutMs) &&
    reviewTimeoutMs > 0
  )
    ? reviewTimeoutMs + LOCAL_REVIEW_CLI_TIMEOUT_GRACE_MS
    : undefined;
  const env = buildLocalReviewEnv(reviewTimeoutMs);

  try {
    const result = await execFileAsync(process.execPath, command.argv, {
      cwd: repoPath,
      encoding: 'utf8',
      env,
      maxBuffer: LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES,
      timeout: outerTimeoutMs,
    });
    stdout = result.stdout.trim();
  } catch (error) {
    if (typeof error?.signal === 'string' && error.signal.length > 0) {
      return {
        status: 'manual_review_required',
        findings: [],
        risk_notes: [`Local review runner exceeded the outer timeout after ${outerTimeoutMs}ms.`],
      };
    }

    if (typeof error?.code !== 'number' || ![1, 2].includes(error.code)) {
      throw error;
    }

    stdout = String(error.stdout ?? '').trim();
  }

  if (!stdout) {
    return {
      status: 'manual_review_required',
      findings: [],
      risk_notes: ['Local review runner did not return output.'],
    };
  }

  try {
    return normalizeLocalReviewResult(JSON.parse(stdout));
  } catch (error) {
    return {
      status: 'manual_review_required',
      findings: [],
      risk_notes: [`Local review runner returned invalid JSON: ${String(error.message ?? error)}`],
    };
  }
}

async function resolveLocalReviewBaseRef({ prUrl, cwd }) {
  const baseRefName = await runCommand(
    'gh',
    ['pr', 'view', prUrl, '--json', 'baseRefName', '--jq', '.baseRefName'],
    { cwd },
  );
  const baseRefOid = await runCommand(
    'gh',
    ['pr', 'view', prUrl, '--json', 'baseRefOid', '--jq', '.baseRefOid'],
    { cwd },
  );

  if (baseRefOid && await gitCommitObjectExists(cwd, baseRefOid)) {
    return baseRefOid;
  }

  if (baseRefName && baseRefOid) {
    await fetchBaseRef(cwd, baseRefName);
  }

  if (baseRefOid && await gitCommitObjectExists(cwd, baseRefOid)) {
    return baseRefOid;
  }

  throw new Error(`Could not resolve a trusted local review base ref for ${prUrl}.`);
}

async function gitCommitObjectExists(cwd, revision) {
  try {
    await runCommand('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function fetchBaseRef(cwd, baseRefName) {
  try {
    await runCommand('git', ['fetch', '--no-tags', 'origin', baseRefName], {
      cwd,
      maxBuffer: LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES,
    });
  } catch {
    // Keep the final decision fail-closed; fetch is only a best-effort refresh.
  }
}

async function runFakeLocalReview({
  statePath,
  prUrl,
  headSha,
  repoPath,
  changedFiles,
  taskHint,
  reviewTimeoutMs,
}) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const prNumber = parseGitHubPrUrl(prUrl).number;
  const baseRef = state.currentBaseRefOids?.[prNumber] ?? state.baseRefOids?.[prNumber]?.[0] ?? 'main';
  const command = buildLocalReviewCommand({ baseRef, headSha, changedFiles, taskHint });
  state.commands.push({
    bin: command.bin,
    argv: command.argv,
  });

  const localReviewState = shiftQueue(state.localReviews?.[prNumber]?.[headSha], null);
  const normalizedLocalReviewState = localReviewState
    ? normalizeLocalReviewResult(localReviewState)
    : synthesizeLegacyLocalReviewResult(state, prNumber, headSha);

  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return normalizedLocalReviewState;
}

function synthesizeLegacyLocalReviewResult(state, prNumber, headSha) {
  const queuedReviews = state.reviews?.[prNumber]?.[headSha];
  if (!Array.isArray(queuedReviews) || queuedReviews.length === 0) {
    return {
      status: 'manual_review_required',
      findings: [],
      risk_notes: ['No fake local review result was configured.'],
    };
  }

  let latestReview = shiftQueue(queuedReviews, { status: 'pending' });
  while (Array.isArray(queuedReviews) && queuedReviews.length > 0) {
    latestReview = shiftQueue(queuedReviews, latestReview);
  }

  if (latestReview?.status === 'pending') {
    return {
      status: 'manual_review_required',
      findings: [],
      risk_notes: ['Fake local review fixture remained pending.'],
    };
  }

  const reviewId = latestReview?.review_id === undefined ? null : String(latestReview.review_id);
  const findings = reviewId ? flattenLegacyCommentState(state.comments?.[prNumber]?.[reviewId]) : [];
  return {
    status: findings.length > 0 ? 'findings' : 'clean',
    review_id: reviewId ?? undefined,
    findings,
  };
}

function flattenLegacyCommentState(commentState) {
  if (!commentState) {
    return [];
  }

  if (Array.isArray(commentState)) {
    if (commentState.length === 0) {
      return [];
    }

    if (Array.isArray(commentState[0])) {
      return commentState.flat();
    }

    return commentState;
  }

  if (Array.isArray(commentState.polls)) {
    const flattenedPolls = commentState.polls.flatMap((poll) => flattenLegacyCommentState(poll));
    return flattenedPolls;
  }

  return [];
}

function normalizeLocalReviewResult(reviewResult) {
  if (!reviewResult || typeof reviewResult !== 'object') {
    return {
      status: 'manual_review_required',
      findings: [],
      risk_notes: ['Local review did not return a valid result.'],
    };
  }

  if (reviewResult.status === 'clean' || reviewResult.status === 'findings') {
    if (!Array.isArray(reviewResult.findings)) {
      return {
        status: 'manual_review_required',
        findings: [],
        risk_notes: ['Local review returned a non-array findings payload.'],
      };
    }

    if (reviewResult.status === 'clean' && reviewResult.findings.length > 0) {
      return {
        status: 'manual_review_required',
        findings: [],
        risk_notes: ['Local review returned a clean status with inline findings.'],
      };
    }

    if (reviewResult.status === 'findings' && reviewResult.findings.length === 0) {
      return {
        status: 'manual_review_required',
        findings: [],
        risk_notes: ['Local review returned a findings status without inline findings.'],
      };
    }

    return {
      status: reviewResult.status,
      review_id: typeof reviewResult.review_id === 'string' ? reviewResult.review_id : undefined,
      findings: reviewResult.findings,
      risk_notes: Array.isArray(reviewResult.risk_notes) ? reviewResult.risk_notes : [],
    };
  }

  return {
    status: 'manual_review_required',
    findings: Array.isArray(reviewResult.findings) ? reviewResult.findings : [],
    risk_notes: [
      ...(Array.isArray(reviewResult.risk_notes) ? reviewResult.risk_notes : []),
      ...(typeof reviewResult.failure_message === 'string' && reviewResult.failure_message.length > 0
        ? [reviewResult.failure_message]
        : []),
    ],
  };
}

function shiftQueue(queue, fallback) {
  if (!Array.isArray(queue) || queue.length === 0) {
    return fallback;
  }

  return queue.shift();
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
