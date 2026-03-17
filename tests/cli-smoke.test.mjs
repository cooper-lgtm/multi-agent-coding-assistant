import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, 'dist', 'cli', 'main.js');

test('cli help exposes plan/run/resume and key flags', () => {
  const output = execFileSync('node', [cliPath, '--help'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.match(output, /\bplan\b/);
  assert.match(output, /\brun\b/);
  assert.match(output, /\bresume\b/);
  assert.match(output, /--repo-path/);
  assert.match(output, /--planning-mode/);
  assert.match(output, /--execution-runtime/);
  assert.match(output, /--output/);
  assert.match(output, /mock\|goose/);
  assert.match(output, /json/);
});

test('importing the library entrypoint does not execute the CLI', () => {
  const output = execFileSync(
    'node',
    ['--input-type=module', '--eval', "await import('./dist/index.js');"],
    {
      cwd: projectRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(output, '');
});

test('cli help still executes when launched through a symlinked bin path', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'maca-bin-'));
  const symlinkPath = path.join(tempDir, 'maca');

  try {
    await symlink(cliPath, symlinkPath);

    const output = execFileSync('node', [symlinkPath, '--help'], {
      cwd: projectRoot,
      encoding: 'utf8'
    });

    assert.match(output, /multi-agent-coding-assistant CLI/);
    assert.match(output, /\bplan\b/);
    assert.match(output, /\brun\b/);
    assert.match(output, /\bresume\b/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
