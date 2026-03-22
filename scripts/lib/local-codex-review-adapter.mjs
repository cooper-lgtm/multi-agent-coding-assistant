import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const LOCAL_REVIEW_SCRIPT_PATH = fileURLToPath(new URL('../run-local-codex-review.mjs', import.meta.url));
const LOCAL_REVIEW_RUNNER_TIMEOUT_GRACE_MS = 1_000;

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
  const resolvedStructuredReviewTimeoutMs = resolveStructuredReviewTimeoutMs(
    structuredReviewTimeoutMs,
    env.LOCAL_CODEX_REVIEW_TIMEOUT_MS,
  );

  if (sourceCodexHome) {
    env.LOCAL_CODEX_REVIEW_SOURCE_HOME = sourceCodexHome;
  }

  if (resolvedStructuredReviewTimeoutMs !== undefined) {
    env.LOCAL_CODEX_REVIEW_TIMEOUT_MS = String(resolvedStructuredReviewTimeoutMs);
  }

  const args = [
    env.LOCAL_CODEX_REVIEW_RUNNER_PATH?.trim() || LOCAL_REVIEW_SCRIPT_PATH,
    ...buildReviewArgs(reviewOptions),
    '--output-format',
    'json',
  ];

  let stdout = '';
  const outerTimeoutMs = (
    typeof resolvedStructuredReviewTimeoutMs === 'number' &&
    Number.isFinite(resolvedStructuredReviewTimeoutMs) &&
    resolvedStructuredReviewTimeoutMs > 0
  )
    ? resolvedStructuredReviewTimeoutMs + LOCAL_REVIEW_RUNNER_TIMEOUT_GRACE_MS
    : undefined;
  try {
    stdout = await runCommand(process.execPath, args, {
      cwd,
      env,
      timeout: outerTimeoutMs,
    });
  } catch (error) {
    if (typeof error?.signal === 'string' && error.signal.length > 0) {
      return {
        status: 'manual_review_required',
        findings: [],
        failure_message: `Local review runner exceeded the outer timeout after ${outerTimeoutMs}ms.`,
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

function resolveStructuredReviewTimeoutMs(structuredReviewTimeoutMs, envTimeoutMs) {
  if (
    typeof structuredReviewTimeoutMs === 'number' &&
    Number.isFinite(structuredReviewTimeoutMs) &&
    structuredReviewTimeoutMs > 0
  ) {
    return structuredReviewTimeoutMs;
  }

  const parsedEnvTimeoutMs = Number.parseInt(String(envTimeoutMs ?? '').trim(), 10);
  return Number.isFinite(parsedEnvTimeoutMs) && parsedEnvTimeoutMs > 0
    ? parsedEnvTimeoutMs
    : undefined;
}

async function runCommand(command, args, options) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: LOCAL_REVIEW_OUTPUT_MAX_BUFFER_BYTES,
    timeout: options.timeout,
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

  if (reviewResult.status === 'clean' || reviewResult.status === 'findings') {
    if (!Array.isArray(reviewResult.findings)) {
      return {
        status: 'manual_review_required',
        findings: [],
        failure_message: 'Local review runner returned a non-array findings payload.',
      };
    }

    return {
      status: reviewResult.status,
      findings: reviewResult.findings,
      failure_message: typeof reviewResult.failure_message === 'string' ? reviewResult.failure_message : null,
    };
  }

  if (reviewResult.status === 'manual_review_required') {
    return {
      status: reviewResult.status,
      findings: Array.isArray(reviewResult.findings) ? reviewResult.findings : [],
      failure_message: typeof reviewResult.failure_message === 'string' ? reviewResult.failure_message : null,
    };
  }

  return {
    status: 'manual_review_required',
    findings: [],
    failure_message: `Local review runner returned an unsupported status: ${String(reviewResult.status ?? 'undefined')}`,
  };
}
