import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runLocalCodexReview } from '../scripts/lib/local-codex-review-adapter.mjs';

test('runLocalCodexReview returns findings for an explicit PR-style head range without including unrelated untracked files', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'local-codex-review-adapter-range-'));

  try {
    const repoRoot = path.join(tempRoot, 'repo');
    await mkdir(repoRoot, { recursive: true });
    await writeFile(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');

    runGit(repoRoot, ['init', '--initial-branch=main']);
    runGit(repoRoot, ['config', 'user.name', 'Codex Test']);
    runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'base']);
    runGit(repoRoot, ['checkout', '-b', 'codex/task-review']);

    await writeFile(path.join(repoRoot, 'tracked.txt'), 'base\nbranch change\n', 'utf8');
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'branch change']);

    await writeFile(path.join(repoRoot, 'scratch.txt'), 'untracked scratch\n', 'utf8');

    const { fakeBinPath, sourceCodexHome, capturePath } = await setupFakeCodexEnvironment(tempRoot, 'findings');
    const result = await runLocalCodexReview({
      cwd: repoRoot,
      reviewOptions: {
        mode: 'head-range',
        baseRef: 'main',
        headRef: 'HEAD',
      },
      extraEnv: {
        PATH: `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_CODEX_CAPTURE: capturePath,
        FAKE_CODEX_MODE: 'findings',
        FAKE_CODEX_FINDING_PATH: path.join(repoRoot, 'tracked.txt'),
        FAKE_CODEX_FINDING_START: '2',
        FAKE_CODEX_FINDING_END: '2',
        LOCAL_CODEX_REVIEW_SOURCE_HOME: sourceCodexHome,
        TEST_PROVIDER_KEY: 'provider-secret',
        LOCAL_CODEX_REVIEW_TRUSTED_RUNNER_BOOTSTRAPPED: '1',
      },
    });

    assert.equal(result.status, 'findings');
    assert.deepEqual(result.findings, [
      {
        path: 'tracked.txt',
        body: 'Example body.',
      },
    ]);

    const capture = JSON.parse(await readFile(capturePath, 'utf8'));
    assert.match(capture.stdin, /Review changes against base ref: main and head ref: HEAD\./);
    assert.match(capture.stdin, /tracked\.txt/);
    assert.doesNotMatch(capture.stdin, /scratch\.txt/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('runLocalCodexReview returns manual_review_required when the structured payload is invalid', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'local-codex-review-adapter-invalid-'));

  try {
    const repoRoot = path.join(tempRoot, 'repo');
    await mkdir(repoRoot, { recursive: true });
    await writeFile(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');

    runGit(repoRoot, ['init', '--initial-branch=main']);
    runGit(repoRoot, ['config', 'user.name', 'Codex Test']);
    runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'base']);

    await writeFile(path.join(repoRoot, 'tracked.txt'), 'base\nbranch change\n', 'utf8');

    const { fakeBinPath, sourceCodexHome, capturePath } = await setupFakeCodexEnvironment(tempRoot, 'invalid');
    const result = await runLocalCodexReview({
      cwd: repoRoot,
      reviewOptions: {
        mode: 'uncommitted',
        target: null,
      },
      extraEnv: {
        PATH: `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_CODEX_CAPTURE: capturePath,
        FAKE_CODEX_MODE: 'invalid',
        LOCAL_CODEX_REVIEW_SOURCE_HOME: sourceCodexHome,
        TEST_PROVIDER_KEY: 'provider-secret',
        LOCAL_CODEX_REVIEW_TRUSTED_RUNNER_BOOTSTRAPPED: '1',
      },
    });

    assert.equal(result.status, 'manual_review_required');
    assert.deepEqual(result.findings, []);
    assert.match(result.failure_message, /Structured review payload/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function setupFakeCodexEnvironment(tempRoot, mode) {
  const fakeBinPath = path.join(tempRoot, 'fake-bin');
  const sourceCodexHome = path.join(tempRoot, 'source-codex-home');
  const capturePath = path.join(tempRoot, 'capture.json');
  const fakeCodexPath = path.join(fakeBinPath, 'codex');

  await mkdir(fakeBinPath, { recursive: true });
  await mkdir(sourceCodexHome, { recursive: true });
  await writeFile(
    path.join(sourceCodexHome, 'config.toml'),
    [
      'model = "gpt-5.4"',
      'model_provider = "cliproxyapi"',
      '',
      '[model_providers.cliproxyapi]',
      'name = "CLIProxyAPI"',
      'wire_api = "responses"',
      'supports_websockets = false',
      'stream_max_retries = 2',
      'request_max_retries = 2',
      'base_url = "http://localhost:8317/v1"',
      'env_key = "TEST_PROVIDER_KEY"',
      '',
      '[features]',
      'multi_agent = true',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const capturePath = process.env.FAKE_CODEX_CAPTURE;
const mode = process.env.FAKE_CODEX_MODE;
const outIndex = args.indexOf('-o');
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const repoFindingPath = process.env.FAKE_CODEX_FINDING_PATH ?? path.join(process.cwd(), 'README.md');
const findingStart = Number.parseInt(process.env.FAKE_CODEX_FINDING_START ?? '2', 10);
const findingEnd = Number.parseInt(process.env.FAKE_CODEX_FINDING_END ?? String(findingStart), 10);

let stdin = '';
process.stdin.on('data', (chunk) => { stdin += chunk.toString(); });
process.stdin.on('end', () => {
  fs.writeFileSync(capturePath, JSON.stringify({ args, stdin }, null, 2));

  if (mode === 'findings') {
    fs.writeFileSync(outFile, JSON.stringify({
      findings: [{
        title: 'Example finding',
        body: 'Example body.',
        confidence_score: 0.91,
        priority: 'P1',
        code_location: {
          absolute_file_path: repoFindingPath,
          line_range: { start: findingStart, end: findingEnd },
        },
      }],
      overall_correctness: 'patch is incorrect',
      overall_explanation: 'One issue found.',
      overall_confidence_score: 0.91,
    }));
    process.exit(0);
  }

  if (mode === 'invalid') {
    fs.writeFileSync(outFile, 'not-json');
    process.exit(0);
  }

  fs.writeFileSync(outFile, JSON.stringify({
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'No actionable issues.',
    overall_confidence_score: 0.9,
  }));
  process.exit(0);
});
`,
    'utf8',
  );
  await chmod(fakeCodexPath, 0o755);

  return { fakeBinPath, sourceCodexHome, capturePath, mode };
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
