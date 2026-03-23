import fs from 'node:fs';
import path from 'node:path';

import type { WorkerEnvironmentSnapshot, WorkerPackageManager } from '../workers/contracts.js';

interface PackageJsonShape {
  packageManager?: unknown;
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
  const packageManifestPath = path.join(repoPath, 'package.json');
  const lockfiles = detectLockfiles(repoPath);
  if (!fs.existsSync(packageManifestPath)) {
    const lockfile = lockfiles[0] ?? null;

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
  const manifestPackageManager = parseManifestPackageManager(packageJson?.packageManager);
  const packageManager = manifestPackageManager ?? lockfiles[0]?.packageManager ?? 'unknown';
  const selectedLockfile = manifestPackageManager
    ? findLockfileForManager(lockfiles, manifestPackageManager)
    : (lockfiles[0] ?? null);

  return {
    package_manager: packageManager,
    package_manifest_path: 'package.json',
    lockfile_path: selectedLockfile?.filename ?? null,
    build_command: toScriptCommand(packageManager, 'build', scripts),
    test_commands: Object.keys(scripts)
      .filter((scriptName) => scriptName === 'test' || scriptName.startsWith('test:'))
      .map((scriptName) => toScriptCommand(packageManager, scriptName, scripts))
      .filter((command): command is string => typeof command === 'string'),
  };
}

function detectLockfiles(repoPath: string): Array<{ filename: string; packageManager: WorkerPackageManager }> {
  return LOCKFILE_PACKAGE_MANAGERS.filter((candidate) => fs.existsSync(path.join(repoPath, candidate.filename)));
}

function readPackageJson(packageManifestPath: string): PackageJsonShape | null {
  try {
    const raw = fs.readFileSync(packageManifestPath, 'utf8');
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

function parseManifestPackageManager(value: unknown): WorkerPackageManager | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const manager = value.split('@', 1)[0];
  if (manager === 'npm' || manager === 'pnpm' || manager === 'yarn' || manager === 'bun') {
    return manager;
  }

  return null;
}

function findLockfileForManager(
  lockfiles: Array<{ filename: string; packageManager: WorkerPackageManager }>,
  packageManager: WorkerPackageManager,
): { filename: string; packageManager: WorkerPackageManager } | null {
  return lockfiles.find((lockfile) => lockfile.packageManager === packageManager) ?? null;
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
      return `npm run ${scriptName}`;
  }
}
