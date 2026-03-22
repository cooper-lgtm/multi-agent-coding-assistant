import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('package.json exposes repository-local lint commands', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));

  assert.equal(typeof packageJson.scripts?.lint, 'string');
  assert.equal(typeof packageJson.scripts?.['lint:js'], 'string');
  assert.equal(typeof packageJson.scripts?.['lint:md'], 'string');
  assert.equal(typeof packageJson.scripts?.['lint:yml'], 'string');
});

test('repository ships a dedicated CI Lint workflow backed by super-linter', () => {
  const workflow = readRepoFile('.github/workflows/ci-lint.yml');
  const validateAssignments = [...workflow.matchAll(/^\s+(VALIDATE_[A-Z0-9_]+):\s+(true|false)$/gm)]
    .filter(([, key]) => key !== 'VALIDATE_ALL_CODEBASE');
  const validateValues = new Set(validateAssignments.map(([, , value]) => value));

  assert.match(workflow, /^name:\s+CI Lint$/m);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /uses:\s+actions\/checkout@v[0-9]+/);
  assert.match(workflow, /fetch-depth:\s+0/);
  assert.match(workflow, /LINTER_RULES_PATH:\s+\./);
  assert.match(workflow, /uses:\s+super-linter\/super-linter@v8/);
  assert.match(workflow, /VALIDATE_ALL_CODEBASE:\s+false/);
  assert.match(workflow, /VALIDATE_TYPESCRIPT_ES:\s+true/);
  assert.match(workflow, /VALIDATE_JAVASCRIPT_ES:\s+true/);
  assert.match(workflow, /VALIDATE_MARKDOWN:\s+true/);
  assert.match(workflow, /VALIDATE_GITHUB_ACTIONS:\s+true/);
  assert.deepEqual([...validateValues], ['true']);
});

test('architecture docs keep future lint execution under test-agent using local commands', () => {
  const architecture = readRepoFile('ARCHITECTURE.md');
  const agents = readRepoFile('AGENTS.md');

  assert.match(
    architecture,
    /test-agent[\s\S]*local lint command/i,
  );
  assert.match(
    agents,
    /test-agent[\s\S]*local lint command/i,
  );
  assert.doesNotMatch(architecture, /lint-agent/i);
  assert.doesNotMatch(agents, /lint-agent/i);
});
