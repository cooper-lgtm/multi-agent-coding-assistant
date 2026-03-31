import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { installGitHooks } from '../scripts/install-git-hooks.mjs';

test('installGitHooks succeeds when the source hook already lives in the target repository', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'install-git-hooks-same-repo-'));
  const hooksPath = path.join(tempRoot, '.githooks');
  const prePushHookPath = path.join(hooksPath, 'pre-push');

  try {
    execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'pipe' });
    await mkdir(hooksPath, { recursive: true });
    await writeFile(prePushHookPath, '#!/usr/bin/env sh\nexit 0\n', 'utf8');
    await chmod(prePushHookPath, 0o644);

    await installGitHooks({
      repoPath: tempRoot,
      sourcePrePushHookPath: prePushHookPath,
    });

    const installedHook = await readFile(prePushHookPath, 'utf8');
    const configuredHooksPath = execFileSync('git', ['config', 'core.hooksPath'], {
      cwd: tempRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    assert.equal(installedHook, '#!/usr/bin/env sh\nexit 0\n');
    assert.equal(configuredHooksPath, '.githooks');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('installGitHooks wires a copied hook to the provided review runner path', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'install-git-hooks-foreign-repo-'));
  const hookPath = path.join(tempRoot, '.githooks', 'pre-push');
  const capturePath = path.join(tempRoot, 'review-command.json');
  const fakeRunnerPath = path.join(tempRoot, 'tooling', 'review-runner.mjs');
  const sourceHookPath = path.join(process.cwd(), '.githooks', 'pre-push');

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Codex Test'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: tempRoot, stdio: 'pipe' });
    await mkdir(path.dirname(fakeRunnerPath), { recursive: true });
    await writeFile(
      fakeRunnerPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`,
      'utf8',
    );
    await chmod(fakeRunnerPath, 0o755);
    await writeFile(path.join(tempRoot, 'README.md'), 'test\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: tempRoot, stdio: 'pipe' });

    await installGitHooks({
      repoPath: tempRoot,
      sourcePrePushHookPath: sourceHookPath,
      sourceReviewRunnerPath: fakeRunnerPath,
    });

    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tempRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const hookResult = execFileSync(
      hookPath,
      ['origin', 'https://github.com/example/repo.git'],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        input: `refs/heads/feature ${headSha} refs/heads/feature 0000000000000000000000000000000000000000\n`,
      },
    );

    assert.equal(hookResult, '');
    const capturedArgs = JSON.parse(await readFile(capturePath, 'utf8'));
    assert.deepEqual(capturedArgs, ['--head-range', 'main', headSha]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
