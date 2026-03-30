import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, 'scripts', 'analyze-run-traces.mjs');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'runtime-traces');

test('analyze-run-traces script renders the expected markdown summary for fixture traces', () => {
  const output = execFileSync('node', [scriptPath, '--state-dir', fixtureDir], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.match(output, /^# Run Trace Analysis/m);
  assert.match(output, /- Sources analyzed: 1/);
  assert.match(output, /- Retry events: 4/);
  assert.match(output, /## Blocker Categories/);
  assert.match(output, /\| repository \| 3 \| task-ui-shell \|/);
  assert.match(output, /## Retry Hotspots/);
  assert.match(output, /\| task-api-contract \| 3 \| claude, gemini \| quality_needs_fix \|/);
  assert.match(output, /## Model-Linked Failure Hotspots/);
  assert.match(output, /\| claude \| quality_needs_fix \| 2 \| anthropic\/claude-opus-4-6 \|/);
});
