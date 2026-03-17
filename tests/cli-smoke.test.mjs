import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
