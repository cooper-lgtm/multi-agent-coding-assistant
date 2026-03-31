#!/usr/bin/env node

import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PRE_PUSH_HOOK_PATH = path.join(SCRIPT_REPO_ROOT, '.githooks', 'pre-push');

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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const hooksPath = path.join(options.repoPath, '.githooks');
  const prePushHookPath = path.join(hooksPath, 'pre-push');

  await mkdir(hooksPath, { recursive: true });
  await copyFile(SOURCE_PRE_PUSH_HOOK_PATH, prePushHookPath);
  await chmod(prePushHookPath, 0o755);

  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: options.repoPath,
    stdio: 'pipe',
  });
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${String(error.message ?? error)}\n`);
  process.exitCode = 1;
}
