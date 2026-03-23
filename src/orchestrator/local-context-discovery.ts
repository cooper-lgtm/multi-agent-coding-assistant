import fs from 'node:fs';
import path from 'node:path';

import type { WorkerEnvironmentSnapshot, WorkerPackageManager } from '../workers/contracts.js';

interface PackageJsonShape {
  scripts?: Record<string, unknown>;
}

const LOCKFILE_PACKAGE_MANAGERS: Array<{
  filename: string;
  packageManager: WorkerPackageManager;
}> = [
  { filename: 'package-lock.json', packageManager: 'npm' },
  { filename: 'pnpm-lock.yaml', packageManager: 'pnpm' },
  { filename: 'yarn.lock', packageManager: 'yarn' },
  { filename: 'bun.lockb', packageManager: 'bun' },
  { filename: 'npm-shrinkwrap.json', packageManager: 'npm' },
];

export function discoverLocalExecutionHints(repoPath: string): WorkerEnvironmentSnapshot {
  const lockfile = detectLockfile(repoPath);
  const packageManifestPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(packageManifestPath)) {
    return {
      package_manager: lockfile?.packageManager ?? 'unknown',
      package_manifest_path: null,
      lockfile_path: lockfile?.filename ?? null,
      build_command: null,
      test_commands: [],
    };
  }

  const packageJson = readPackageJson(packageManifestPath);
  const scripts = packageJson?.scripts ?? {};
  const packageManager = lockfile?.packageManager ?? 'unknown';

  return {
    package_manager: packageManager,
    package_manifest_path: 'package.json',
    lockfile_path: lockfile?.filename ?? null,
    build_command: toScriptCommand(packageManager, 'build', scripts),
    test_commands: Object.keys(scripts)
      .filter((scriptName) => scriptName === 'test' || scriptName.startsWith('test:'))
      .map((scriptName) => toScriptCommand(packageManager, scriptName, scripts))
      .filter((command): command is string => typeof command === 'string'),
  };
}

function detectLockfile(repoPath: string): { filename: string; packageManager: WorkerPackageManager } | null {
  for (const candidate of LOCKFILE_PACKAGE_MANAGERS) {
    if (fs.existsSync(path.join(repoPath, candidate.filename))) {
      return candidate;
    }
  }

  return null;
}

function readPackageJson(packageManifestPath: string): PackageJsonShape | null {
  try {
    const raw = fs.readFileSync(packageManifestPath, 'utf8');
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

function toScriptCommand(
  packageManager: WorkerPackageManager,
  scriptName: string,
  scripts: Record<string, unknown>,
): string | null {
  const script = scripts[scriptName];
  if (typeof script !== 'string' || !script.trim()) {
    return null;
  }

  switch (packageManager) {
    case 'npm':
      return `npm run ${scriptName}`;
    case 'pnpm':
      return `pnpm run ${scriptName}`;
    case 'yarn':
      return `yarn ${scriptName}`;
    case 'bun':
      return `bun run ${scriptName}`;
    case 'unknown':
      return null;
  }
}
