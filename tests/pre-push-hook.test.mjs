import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('pre-push hook prefers the pushed branch gh-merge-base and reviews the pushed head range', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'pre-push-hook-gh-merge-base-'));
  const hookTargetPath = path.join(tempRoot, '.githooks', 'pre-push');
  const fakeReviewScriptPath = path.join(tempRoot, 'scripts', 'run-local-codex-review.mjs');
  const capturePath = path.join(tempRoot, 'review-command.json');
  const sourceHookPath = path.join(process.cwd(), '.githooks', 'pre-push');

  try {
    await mkdir(path.dirname(hookTargetPath), { recursive: true });
    await mkdir(path.dirname(fakeReviewScriptPath), { recursive: true });
    await cp(sourceHookPath, hookTargetPath);
    await chmod(hookTargetPath, 0o755);

    await writeFile(
      fakeReviewScriptPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`,
      'utf8',
    );
    await chmod(fakeReviewScriptPath, 0o755);

    execFileSync('git', ['init', '-b', 'main'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Codex Test'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: tempRoot, stdio: 'pipe' });
    await writeFile(path.join(tempRoot, 'README.md'), 'test\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['branch', 'develop'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: tempRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'branch.feature.gh-merge-base', 'develop'], { cwd: tempRoot, stdio: 'pipe' });

    const featureSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tempRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const hookResult = spawnSync(
      hookTargetPath,
      ['origin', 'https://github.com/example/repo.git'],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        input: `refs/heads/feature ${featureSha} refs/heads/feature 0000000000000000000000000000000000000000\n`,
      },
    );

    assert.equal(hookResult.status, 0, hookResult.stderr);

    const capturedArgs = JSON.parse(await readFile(capturePath, 'utf8'));
    assert.deepEqual(capturedArgs, ['--head-range', 'develop', 'HEAD']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
