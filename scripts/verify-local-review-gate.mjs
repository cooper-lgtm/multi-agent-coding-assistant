#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localReviewRunnerPath = fileURLToPath(new URL('./run-local-codex-review.mjs', import.meta.url));
const TEST_FILES = [
  'tests/local-codex-review.test.mjs',
  'tests/run-plan-doc.test.mjs',
  'tests/plan-runner.test.mjs',
];
const DEFAULT_BASE_REF_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'];

function parseArgs(argv) {
  const options = {
    baseRef: null,
    headRef: 'HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base-ref') {
      if (!next || next.startsWith('--')) {
        throw new Error('--base-ref requires a value.');
      }
      options.baseRef = next;
      index += 1;
      continue;
    }

    if (arg === '--head-ref') {
      if (!next || next.startsWith('--')) {
        throw new Error('--head-ref requires a value.');
      }
      options.headRef = next;
      index += 1;
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

function gitRefExists(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function resolveBaseRef(explicitBaseRef) {
  if (explicitBaseRef) {
    return explicitBaseRef;
  }

  for (const candidate of DEFAULT_BASE_REF_CANDIDATES) {
    if (gitRefExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not resolve a default base ref. Tried: ${DEFAULT_BASE_REF_CANDIDATES.join(', ')}. Pass --base-ref explicitly.`,
  );
}

function runStep(command, args) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(`${command} exited due to signal ${result.signal}.`);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const options = parseArgs(process.argv.slice(2));
const baseRef = resolveBaseRef(options.baseRef);

runStep('npm', ['run', 'build']);
runStep(process.execPath, ['--test', ...TEST_FILES]);
runStep(process.execPath, [localReviewRunnerPath, '--head-range', baseRef, options.headRef, '--output-format', 'json']);
runStep('git', ['diff', '--check']);
