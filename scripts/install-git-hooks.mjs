#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PRE_PUSH_HOOK_PATH = path.join(SCRIPT_REPO_ROOT, '.githooks', 'pre-push');
const SOURCE_REVIEW_RUNNER_PATH = path.join(SCRIPT_REPO_ROOT, 'scripts', 'run-local-codex-review.mjs');

function parseArgs(argv) {
  const options = {
    repoPath: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-path') {
      options.repoPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export async function installGitHooks({
  repoPath,
  sourcePrePushHookPath = SOURCE_PRE_PUSH_HOOK_PATH,
  sourceReviewRunnerPath = SOURCE_REVIEW_RUNNER_PATH,
} = {}) {
  const hooksPath = path.join(repoPath, '.githooks');
  const prePushHookPath = path.join(hooksPath, 'pre-push');

  await mkdir(hooksPath, { recursive: true });
  if (path.resolve(sourcePrePushHookPath) !== path.resolve(prePushHookPath)) {
    const hookSource = await readFile(sourcePrePushHookPath, 'utf8');
    await writeFile(
      prePushHookPath,
      buildInstalledHookSource(hookSource, {
        sourceReviewRunnerPath,
      }),
      'utf8',
    );
  }
  await chmod(prePushHookPath, 0o755);

  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

function buildInstalledHookSource(sourceHook, { sourceReviewRunnerPath }) {
  const normalizedRunnerPath = path.resolve(sourceReviewRunnerPath);
  const escapedRunnerPath = normalizedRunnerPath.replaceAll("'", "'\"'\"'");
  const runnerPathDeclaration = `LOCAL_CODEX_REVIEW_RUNNER_PATH='${escapedRunnerPath}'`;

  if (sourceHook.includes('LOCAL_CODEX_REVIEW_RUNNER_PATH=')) {
    return sourceHook.replace(
      /^LOCAL_CODEX_REVIEW_RUNNER_PATH=.*$/m,
      runnerPathDeclaration,
    );
  }

  const setEuPattern = /^set -eu$/m;
  if (setEuPattern.test(sourceHook)) {
    return sourceHook.replace(setEuPattern, `set -eu\n\n${runnerPathDeclaration}`);
  }

  return `${runnerPathDeclaration}\n${sourceHook}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await installGitHooks({ repoPath: options.repoPath });
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${String(error.message ?? error)}\n`);
  process.exitCode = 1;
}
