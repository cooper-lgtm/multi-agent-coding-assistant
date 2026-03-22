import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const LOCAL_REVIEW_SCRIPT_PATH = fileURLToPath(new URL('../run-local-codex-review.mjs', import.meta.url));

export async function runLocalCodexReview({
  cwd = process.cwd(),
  reviewOptions = { mode: 'uncommitted', target: null },
  extraEnv = {},
  sourceCodexHome,
  structuredReviewTimeoutMs,
} = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };

  if (sourceCodexHome) {
    env.LOCAL_CODEX_REVIEW_SOURCE_HOME = sourceCodexHome;
  }

  if (
    typeof structuredReviewTimeoutMs === 'number' &&
    Number.isFinite(structuredReviewTimeoutMs) &&
    structuredReviewTimeoutMs > 0
  ) {
    env.LOCAL_CODEX_REVIEW_TIMEOUT_MS = String(structuredReviewTimeoutMs);
  }

  const args = [
    LOCAL_REVIEW_SCRIPT_PATH,
    ...buildReviewArgs(reviewOptions),
    '--output-format',
    'json',
  ];

  let stdout = '';
  try {
    stdout = await runCommand(process.execPath, args, {
      cwd,
      env,
    });
  } catch (error) {
    if (typeof error?.code !== 'number' || ![1, 2].includes(error.code)) {
      throw error;
    }

    stdout = String(error.stdout ?? '').trim();
  }

  if (!stdout) {
    return {
      status: 'manual_review_required',
      findings: [],
      failure_message: 'Local review runner did not return output.',
    };
  }

  try {
    return normalizeReviewResult(JSON.parse(stdout));
  } catch (error) {
    return {
      status: 'manual_review_required',
      findings: [],
      failure_message: `Local review runner returned invalid JSON: ${String(error.message ?? error)}`,
    };
  }
}

function buildReviewArgs(reviewOptions) {
  if (reviewOptions.mode === 'base') {
    return ['--base', reviewOptions.target];
  }

  if (reviewOptions.mode === 'commit') {
    return ['--commit', reviewOptions.target];
  }

  if (reviewOptions.mode === 'head-range') {
    return ['--head-range', reviewOptions.baseRef, reviewOptions.headRef];
  }

  return ['--uncommitted'];
}

async function runCommand(command, args, options) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES,
  });

  return stdout.trim();
}

function normalizeReviewResult(reviewResult) {
  if (!reviewResult || typeof reviewResult !== 'object') {
    return {
      status: 'manual_review_required',
      findings: [],
      failure_message: 'Local review runner did not return a valid result.',
    };
  }

  return {
    status: reviewResult.status,
    findings: Array.isArray(reviewResult.findings) ? reviewResult.findings : [],
    failure_message: typeof reviewResult.failure_message === 'string' ? reviewResult.failure_message : null,
  };
}
