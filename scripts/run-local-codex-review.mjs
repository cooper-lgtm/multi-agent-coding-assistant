#!/usr/bin/env node

import { lstatSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const GIT_OUTPUT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const ALLOWED_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const DEFAULT_STRUCTURED_REVIEW_TIMEOUT_MS = 30 * 60_000;
const STRUCTURED_REVIEW_KILL_GRACE_MS = 1_000;
const TRUSTED_RUNNER_BOOTSTRAPPED_ENV_KEY = 'LOCAL_CODEX_REVIEW_TRUSTED_RUNNER_BOOTSTRAPPED';
const TRUSTED_RUNNER_SCRIPT_REPO_ROOT_ENV_KEY = 'LOCAL_CODEX_REVIEW_SCRIPT_REPO_ROOT';
const RUNNER_SCRIPT_RELATIVE_PATH = 'scripts/run-local-codex-review.mjs';
const REVIEW_PAYLOAD_KEYS = new Set([
  'findings',
  'overall_correctness',
  'overall_explanation',
  'overall_confidence_score',
]);
const FINDING_KEYS = new Set([
  'title',
  'body',
  'confidence_score',
  'priority',
  'code_location',
]);
const CODE_LOCATION_KEYS = new Set([
  'absolute_file_path',
  'line_range',
]);
const LINE_RANGE_KEYS = new Set([
  'start',
  'end',
]);
const ALWAYS_ALLOWED_CODEX_ENV_KEYS = new Set([
  'CODEX_HOME',
  'CODEX_API_BASE',
  'CODEX_API_KEY',
]);
const scriptRepoRoot = resolveScriptRepoRoot();

function resolveScriptRepoRoot() {
  const explicitScriptRepoRoot = process.env[TRUSTED_RUNNER_SCRIPT_REPO_ROOT_ENV_KEY]?.trim();
  if (explicitScriptRepoRoot) {
    return path.resolve(explicitScriptRepoRoot);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

async function maybeRunTrustedSameRepoRunner(argv) {
  if (process.env[TRUSTED_RUNNER_BOOTSTRAPPED_ENV_KEY] === '1') {
    return null;
  }

  const repoRoot = resolveRepositoryRoot(process.cwd());
  if (!repositoryMatchesScriptRepo(repoRoot)) {
    return null;
  }

  const options = parseArgs(argv);
  const trustedRunnerSource = readBootstrapRunnerSource(repoRoot, options);

  let trustedRunnerTempRoot;
  try {
    trustedRunnerTempRoot = await mkdtemp(path.join(tmpdir(), 'local-codex-review-trusted-runner-'));
    const trustedRunnerPath = path.join(trustedRunnerTempRoot, 'run-local-codex-review.mjs');
    await writeFile(trustedRunnerPath, trustedRunnerSource, 'utf8');

    const result = spawnSync(process.execPath, [trustedRunnerPath, ...argv], {
      stdio: 'inherit',
      env: {
        ...process.env,
        [TRUSTED_RUNNER_BOOTSTRAPPED_ENV_KEY]: '1',
        [TRUSTED_RUNNER_SCRIPT_REPO_ROOT_ENV_KEY]: scriptRepoRoot,
      },
    });

    if (result.error) {
      throw result.error;
    }

    if (result.signal) {
      throw new Error(`Trusted review runner exited due to signal ${result.signal}.`);
    }

    return result.status ?? 1;
  } finally {
    if (trustedRunnerTempRoot) {
      await rm(trustedRunnerTempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function readBootstrapRunnerSource(repoRoot, options) {
  const trustedBootstrapRefs = resolveTrustedBootstrapBaseRefs(repoRoot, options);

  if (options.mode === 'base' && isTrustedBootstrapBaseRef(options.target, trustedBootstrapRefs)) {
    const trustedTargetRunner = readGitFile(repoRoot, options.target, RUNNER_SCRIPT_RELATIVE_PATH);
    if (trustedTargetRunner !== null) {
      return trustedTargetRunner;
    }
  }

  for (const trustedRef of trustedBootstrapRefs) {
    const trustedRunner = readGitFile(scriptRepoRoot, trustedRef, RUNNER_SCRIPT_RELATIVE_PATH);
    if (trustedRunner !== null) {
      return trustedRunner;
    }
  }

  const committedFallbackRevision = resolveCommittedRunnerBootstrapRevision(repoRoot, options);
  if (committedFallbackRevision !== null) {
    const committedRunner = readGitFile(repoRoot, committedFallbackRevision, RUNNER_SCRIPT_RELATIVE_PATH);
    if (committedRunner !== null) {
      return committedRunner;
    }
  }

  const indexedRunner = readGitIndexFile(repoRoot, RUNNER_SCRIPT_RELATIVE_PATH);
  if (indexedRunner !== null) {
    return indexedRunner;
  }

  throw new Error(
    `Could not resolve trusted review runner ${RUNNER_SCRIPT_RELATIVE_PATH}. Fetch origin/main (or another trusted mainline ref), or stage the runner first, so same-repo bootstrap review can run from a frozen baseline.`,
  );
}

function resolveCommittedRunnerBootstrapRevision(repoRoot, options) {
  if (!repositoryMatchesScriptRepo(repoRoot)) {
    return null;
  }

  if (options.mode === 'commit') {
    return runGit(repoRoot, ['rev-parse', '--verify', options.target], { allowedExitCodes: [0, 128] }).trim() || null;
  }

  return runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowedExitCodes: [0, 128] }).trim() || null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let runTempRoot;
  let isolatedCodexHome;

  try {
    const projectRoot = resolveRepositoryRoot(process.cwd());
    const sourceCodexHome = process.env.LOCAL_CODEX_REVIEW_SOURCE_HOME ?? resolveDefaultCodexHome();
    const structuredReviewTimeoutMs = resolveStructuredReviewTimeoutMs(process.env.LOCAL_CODEX_REVIEW_TIMEOUT_MS);
    runTempRoot = await mkdtemp(path.join(tmpdir(), 'local-codex-review-run-'));
    isolatedCodexHome = await mkdtemp(path.join(tmpdir(), 'local-codex-review-home-'));
    const emptyFilePath = path.join(runTempRoot, 'empty-file.txt');
    const outputPath = path.join(runTempRoot, 'review-output.json');
    const promptPath = path.join(runTempRoot, 'review-prompt.txt');
    const schemaPath = path.join(runTempRoot, 'review-schema.json');

    await mkdir(isolatedCodexHome, { recursive: true });
    await copyConfigToml(sourceCodexHome, isolatedCodexHome);
    await copyAuthJsonIfPresent(sourceCodexHome, isolatedCodexHome);
    await writeFile(emptyFilePath, '', 'utf8');

    const scope = collectReviewScope(projectRoot, options, emptyFilePath);
    const postImageHunkLineRanges = collectPostImageHunkLineRanges(projectRoot, scope.patch);
    const deletedLineRanges = collectDeletedLineRanges(projectRoot, scope.patch);
    const renamedFilePathAliases = collectRenamedFilePathAliases(projectRoot, scope.patch);
    const reviewAssets = await loadTrustedReviewAssets(projectRoot, options);
    const prompt = buildPrompt(projectRoot, options, scope, reviewAssets.promptTemplate);
    const outputSchema = tightenStructuredReviewSchema(reviewAssets.outputSchema);
    await writeFile(promptPath, prompt, 'utf8');
    await writeFile(schemaPath, outputSchema, 'utf8');

    const result = await runStructuredReview({
      cwd: projectRoot,
      isolatedCodexHome,
      outputPath,
      outputSchemaPath: schemaPath,
      prompt,
      timeoutMs: structuredReviewTimeoutMs,
    });

    const review = parseStructuredReview(result.lastMessage, {
      repoRoot: projectRoot,
      changedFiles: scope.changedFiles.map((filePath) => path.resolve(projectRoot, filePath)),
      lineRangeExemptFiles: scope.lineRangeExemptFiles.map((filePath) => path.resolve(projectRoot, filePath)),
      postImageHunkLineRanges,
      deletedLineRanges,
      renamedFilePathAliases,
    });

    if (review.findings.length > 0) {
      printFindings(review, {
        repoRoot: projectRoot,
        deletedLineRanges,
        renamedFilePathAliases,
      });
      return 1;
    }

    process.stdout.write('Structured review is clean.\n');
    return 0;
  } catch (error) {
    process.stdout.write(`${String(error.message ?? error)}\n`);
    return 2;
  } finally {
    if (runTempRoot) {
      await rm(runTempRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (isolatedCodexHome) {
      await rm(isolatedCodexHome, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function parseArgs(argv) {
  const options = {
    mode: 'uncommitted',
    target: null,
  };
  let selectedScopeFlag = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--base') {
      const target = argv[index + 1];
      if (!target || target.startsWith('--')) {
        throw new Error('--base requires a value.');
      }
      if (selectedScopeFlag !== null) {
        throw new Error('Choose only one of --base, --commit, or --uncommitted.');
      }
      options.mode = 'base';
      options.target = target;
      selectedScopeFlag = '--base';
      index += 1;
      continue;
    }

    if (arg === '--commit') {
      const target = argv[index + 1];
      if (!target || target.startsWith('--')) {
        throw new Error('--commit requires a value.');
      }
      if (selectedScopeFlag !== null) {
        throw new Error('Choose only one of --base, --commit, or --uncommitted.');
      }
      options.mode = 'commit';
      options.target = target;
      selectedScopeFlag = '--commit';
      index += 1;
      continue;
    }

    if (arg === '--uncommitted') {
      if (selectedScopeFlag !== null) {
        throw new Error('Choose only one of --base, --commit, or --uncommitted.');
      }
      options.mode = 'uncommitted';
      options.target = null;
      selectedScopeFlag = '--uncommitted';
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  if ((options.mode === 'base' || options.mode === 'commit') && !options.target) {
    throw new Error(`${options.mode === 'base' ? '--base' : '--commit'} requires a value.`);
  }

  return options;
}

function resolveDefaultCodexHome() {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error('Could not resolve the default Codex home. Set HOME or LOCAL_CODEX_REVIEW_SOURCE_HOME.');
  }

  const callerCodexHome = process.env.CODEX_HOME?.trim();
  const desktopSessionCodexHome =
    Boolean(process.env.CODEX_SESSION_CONTEXT)
    || Boolean(process.env.CODEX_THREAD_ID)
    || Boolean(process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE);

  if (callerCodexHome && !desktopSessionCodexHome) {
    return callerCodexHome;
  }

  // Ignore CODEX_HOME when the caller is an interactive desktop session so
  // local review does not inherit a thread-specific ephemeral home.
  return path.join(homeDir, '.codex');
}

function resolveRepositoryRoot(startDir) {
  let repoRoot = '';
  try {
    repoRoot = runGit(startDir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new Error('Local review must be run from inside a git repository.');
  }

  if (!repoRoot) {
    throw new Error('Local review must be run from inside a git repository.');
  }

  return repoRoot;
}

function resolveStructuredReviewTimeoutMs(rawTimeoutMs) {
  if (rawTimeoutMs === undefined) {
    return DEFAULT_STRUCTURED_REVIEW_TIMEOUT_MS;
  }

  const normalizedValue = String(rawTimeoutMs).trim();
  if (!normalizedValue) {
    return DEFAULT_STRUCTURED_REVIEW_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(normalizedValue, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('LOCAL_CODEX_REVIEW_TIMEOUT_MS must be a positive integer.');
  }

  return timeoutMs;
}

async function copyConfigToml(sourceCodexHome, isolatedCodexHome) {
  const sourceConfigPath = path.join(sourceCodexHome, 'config.toml');
  const targetConfigPath = path.join(isolatedCodexHome, 'config.toml');

  try {
    const configToml = await readFile(sourceConfigPath, 'utf8');
    await writeFile(targetConfigPath, buildIsolatedConfigToml(configToml), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      await writeFile(targetConfigPath, buildIsolatedConfigToml(''), 'utf8');
      return;
    }

    throw new Error(`Could not read Codex config from ${sourceConfigPath}.`);
  }
}

async function copyAuthJsonIfPresent(sourceCodexHome, isolatedCodexHome) {
  const sourceAuthPath = path.join(sourceCodexHome, 'auth.json');
  const targetAuthPath = path.join(isolatedCodexHome, 'auth.json');

  try {
    const authJson = await readFile(sourceAuthPath, 'utf8');
    await writeFile(targetAuthPath, authJson, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // Auth can also come from provider-specific env vars, so missing auth.json
      // is not fatal for the isolated review gate.
      return;
    }

    throw new Error(`Could not read Codex auth from ${sourceAuthPath}.`);
  }
}

function buildIsolatedConfigToml(sourceConfigToml) {
  const activeProfile = stripTomlQuotes(readScopedScalar(sourceConfigToml, 'profile'));
  const activeProfileSection = activeProfile ? `profiles.${activeProfile}` : null;
  const model = readScopedScalar(sourceConfigToml, 'model', activeProfileSection) ?? readScopedScalar(sourceConfigToml, 'model') ?? '"gpt-5.4"';
  const modelProvider = readScopedScalar(sourceConfigToml, 'model_provider', activeProfileSection) ?? readScopedScalar(sourceConfigToml, 'model_provider') ?? '"openai_http"';
  const modelProviderName = stripTomlQuotes(modelProvider) ?? 'openai_http';
  const serviceTier = readScopedScalar(sourceConfigToml, 'service_tier', activeProfileSection) ?? readScopedScalar(sourceConfigToml, 'service_tier');
  const preservedActiveProfileScalars = activeProfileSection
    ? collectScopedScalarLines(
      sourceConfigToml,
      activeProfileSection,
      new Set(['model', 'model_reasoning_effort', 'model_provider', 'service_tier']),
    )
    : [];
  const activeProfileScalarKeys = new Set(
    preservedActiveProfileScalars
      .map((line) => extractTomlScalarKey(line))
      .filter(Boolean),
  );
  const preservedTopLevelScalars = collectScopedScalarLines(
    sourceConfigToml,
    null,
    new Set(['profile', 'model', 'model_reasoning_effort', 'model_provider', 'service_tier']),
  ).filter((line) => !activeProfileScalarKeys.has(extractTomlScalarKey(line)));
  const preservedActiveProfileFeatureLines = activeProfileSection
    ? collectScopedScalarLines(
      sourceConfigToml,
      `${activeProfileSection}.features`,
      new Set(['multi_agent', 'responses_websockets', 'responses_websockets_v2']),
    )
    : [];
  const activeProfileFeatureKeys = new Set(
    preservedActiveProfileFeatureLines
      .map((line) => extractTomlScalarKey(line))
      .filter(Boolean),
  );
  const preservedTopLevelFeatureLines = collectScopedScalarLines(
    sourceConfigToml,
    'features',
    new Set(['multi_agent', 'responses_websockets', 'responses_websockets_v2']),
  ).filter((line) => !activeProfileFeatureKeys.has(extractTomlScalarKey(line)));
  const selectedProviderBlock = resolveSelectedProviderBlock(
    sourceConfigToml,
    activeProfileSection,
    modelProviderName,
  );
  const preservedActiveProfileFeatureSectionBlocks = activeProfileSection
    ? collectSectionBlocksWithPrefix(
      sourceConfigToml,
      `${activeProfileSection}.features.`,
      [`${activeProfileSection}.model_providers.`],
    ).map((sectionBlock) => rewriteSectionPrefix(sectionBlock, `${activeProfileSection}.`, ''))
    : [];
  const preservedActiveProfileSectionBlocks = activeProfileSection
    ? collectSectionBlocksWithPrefix(
      sourceConfigToml,
      `${activeProfileSection}.`,
      [`${activeProfileSection}.model_providers.`, `${activeProfileSection}.features`],
    ).map((sectionBlock) => rewriteSectionPrefix(sectionBlock, `${activeProfileSection}.`, ''))
    : [];
  const overriddenTopLevelSections = new Set(
    [...preservedActiveProfileSectionBlocks, ...preservedActiveProfileFeatureSectionBlocks]
      .map((sectionBlock) => readTomlSectionName(sectionBlock))
      .filter(Boolean),
  );
  const preservedSectionBlocks = collectSectionBlocks(
    sourceConfigToml,
    new Set(['features']),
    ['profiles.', `model_providers.${modelProviderName}`],
  ).filter((sectionBlock) => !overriddenTopLevelSections.has(readTomlSectionName(sectionBlock)));
  const preservedFeatureSectionBlocks = preservedSectionBlocks.filter((sectionBlock) => {
    const sectionName = readTomlSectionName(sectionBlock);
    return typeof sectionName === 'string' && sectionName.startsWith('features.');
  });
  const preservedNonFeatureSectionBlocks = preservedSectionBlocks.filter((sectionBlock) => {
    const sectionName = readTomlSectionName(sectionBlock);
    return typeof sectionName !== 'string' || !sectionName.startsWith('features.');
  });

  return [
    `model = ${model}`,
    'model_reasoning_effort = "medium"',
    `model_provider = ${modelProvider}`,
    serviceTier ? `service_tier = ${serviceTier}` : null,
    ...preservedTopLevelScalars,
    ...preservedActiveProfileScalars,
    '',
    [selectedProviderBlock, ...preservedActiveProfileSectionBlocks, ...preservedNonFeatureSectionBlocks].filter(Boolean).join('\n\n').trim() || null,
    '',
    '[features]',
    ...preservedTopLevelFeatureLines,
    ...preservedActiveProfileFeatureLines,
    'multi_agent = false',
    'responses_websockets = false',
    'responses_websockets_v2 = false',
    '',
    [...preservedActiveProfileFeatureSectionBlocks, ...preservedFeatureSectionBlocks].join('\n\n').trim() || null,
    '',
  ].filter(Boolean).join('\n');
}

function readScopedScalar(configToml, key, sectionName = null) {
  const lines = configToml.split('\n');
  const scalarPattern = new RegExp(`^${key}\\s*=\\s*(.+)$`);
  let currentSection = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const sectionMatch = trimmedLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    const inTargetSection = sectionName === null ? currentSection === null : currentSection === sectionName;
    if (!inTargetSection) {
      continue;
    }

    const scalarMatch = trimmedLine.match(scalarPattern);
    if (scalarMatch) {
      return stripTomlInlineComment(scalarMatch[1]?.trim() ?? null);
    }
  }

  return null;
}

function readProviderBlock(configToml, providerName, sectionPrefix = '') {
  const lines = configToml.split('\n');
  const providerPrefix = `${sectionPrefix}model_providers.${providerName}`;
  const capturedBlocks = [];
  let currentBlock = [];
  let capturing = false;

  const flushCurrentBlock = () => {
    if (!capturing || currentBlock.length === 0) {
      currentBlock = [];
      return;
    }

    capturedBlocks.push(currentBlock.join('\n').trimEnd());
    currentBlock = [];
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      flushCurrentBlock();
      const sectionName = sectionMatch[1];
      capturing = sectionName === providerPrefix || sectionName.startsWith(`${providerPrefix}.`);
    }

    if (capturing) {
      currentBlock.push(line);
    }
  }

  flushCurrentBlock();

  return capturedBlocks.length > 0 ? capturedBlocks.join('\n\n') : null;
}

function resolveSelectedProviderBlock(configToml, activeProfileSection, providerName) {
  const topLevelProviderBlock = readProviderBlock(configToml, providerName);
  const activeProfileProviderBlock = activeProfileSection
    ? readProviderBlock(configToml, providerName, `${activeProfileSection}.`)
    : null;

  const rewrittenActiveProfileProviderBlock = activeProfileProviderBlock
    ? rewriteSectionPrefix(activeProfileProviderBlock, `${activeProfileSection}.`, '')
    : null;

  return mergeProviderBlocks(topLevelProviderBlock, rewrittenActiveProfileProviderBlock);
}

function rewriteSectionPrefix(sectionBlock, fromPrefix, toPrefix) {
  return sectionBlock
    .split('\n')
    .map((line) => {
      const sectionMatch = line.match(/^\[(.+)\]$/);
      if (!sectionMatch) {
        return line;
      }

      const sectionName = sectionMatch[1];
      if (!sectionName.startsWith(fromPrefix)) {
        return line;
      }

      return `[${toPrefix}${sectionName.slice(fromPrefix.length)}]`;
    })
    .join('\n');
}

function mergeProviderBlocks(baseBlock, overrideBlock) {
  if (!baseBlock) {
    return overrideBlock;
  }

  if (!overrideBlock) {
    return baseBlock;
  }

  const orderedSectionNames = [];
  const mergedSectionLines = new Map();

  for (const section of parseSectionBlockSet(baseBlock)) {
    orderedSectionNames.push(section.name);
    mergedSectionLines.set(section.name, section.lines);
  }

  for (const section of parseSectionBlockSet(overrideBlock)) {
    if (!mergedSectionLines.has(section.name)) {
      orderedSectionNames.push(section.name);
    }

    mergedSectionLines.set(
      section.name,
      mergeSectionScalarLines(mergedSectionLines.get(section.name) ?? [], section.lines),
    );
  }

  return orderedSectionNames
    .map((sectionName) => {
      return [
        `[${sectionName}]`,
        ...mergedSectionLines.get(sectionName),
      ].join('\n');
    })
    .join('\n\n');
}

function parseSectionBlockSet(sectionBlockSet) {
  return collectSectionBlocks(sectionBlockSet).map((sectionBlock) => {
    return {
      name: readTomlSectionName(sectionBlock),
      lines: sectionBlock
        .split('\n')
        .slice(1)
        .filter((line) => {
          const trimmedLine = line.trim();
          return trimmedLine.length > 0 && !trimmedLine.startsWith('#');
        }),
    };
  }).filter((section) => typeof section.name === 'string' && section.name.length > 0);
}

function mergeSectionScalarLines(baseLines, overrideLines) {
  const mergedLines = [...baseLines];
  const scalarLineIndexesByKey = new Map();

  for (const [index, line] of mergedLines.entries()) {
    const key = extractTomlScalarKey(line);
    if (key) {
      scalarLineIndexesByKey.set(key, index);
    }
  }

  for (const line of overrideLines) {
    const key = extractTomlScalarKey(line);
    const existingIndex = key ? scalarLineIndexesByKey.get(key) : undefined;

    if (typeof existingIndex === 'number') {
      mergedLines[existingIndex] = line;
      continue;
    }

    mergedLines.push(line);
    if (key) {
      scalarLineIndexesByKey.set(key, mergedLines.length - 1);
    }
  }

  return mergedLines;
}

function collectScopedScalarLines(configToml, sectionName = null, excludedKeys = new Set()) {
  const lines = configToml.split('\n');
  const collectedLines = [];
  let currentSection = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const sectionMatch = trimmedLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    const inTargetSection = sectionName === null ? currentSection === null : currentSection === sectionName;
    if (!inTargetSection) {
      continue;
    }

    const scalarMatch = trimmedLine.match(/^([^=\s]+)\s*=\s*(.+)$/);
    if (!scalarMatch) {
      continue;
    }

    const key = scalarMatch[1];
    if (excludedKeys.has(key)) {
      continue;
    }

    collectedLines.push(line);
  }

  return collectedLines;
}

function collectSectionBlocks(configToml, excludedSectionNames = new Set(), excludedSectionPrefixes = []) {
  const lines = configToml.split('\n');
  const blocks = [];
  let currentSection = null;
  let currentBlock = [];

  const flushCurrentBlock = () => {
    if (!currentSection || currentBlock.length === 0) {
      currentBlock = [];
      return;
    }

    const isExcluded = excludedSectionNames.has(currentSection) || excludedSectionPrefixes.some((prefix) => currentSection.startsWith(prefix));
    if (!isExcluded) {
      blocks.push(currentBlock.join('\n').trimEnd());
    }

    currentBlock = [];
  };

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^\[(.+)\]$/);
    if (sectionMatch) {
      flushCurrentBlock();
      currentSection = sectionMatch[1];
      currentBlock = [line];
      continue;
    }

    if (currentSection) {
      currentBlock.push(line);
    }
  }

  flushCurrentBlock();
  return blocks.filter(Boolean);
}

function collectSectionBlocksWithPrefix(configToml, sectionPrefix, excludedSectionPrefixes = []) {
  const lines = configToml.split('\n');
  const blocks = [];
  let currentBlock = [];
  let currentSectionMatches = false;

  const flushCurrentBlock = () => {
    if (!currentSectionMatches || currentBlock.length === 0) {
      currentBlock = [];
      return;
    }

    blocks.push(currentBlock.join('\n').trimEnd());
    currentBlock = [];
  };

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^\[(.+)\]$/);
    if (sectionMatch) {
      flushCurrentBlock();
      const sectionName = sectionMatch[1];
      currentSectionMatches = sectionName.startsWith(sectionPrefix)
        && !excludedSectionPrefixes.some((prefix) => sectionName.startsWith(prefix));
      if (currentSectionMatches) {
        currentBlock = [line];
      }
      continue;
    }

    if (currentSectionMatches) {
      currentBlock.push(line);
    }
  }

  flushCurrentBlock();
  return blocks.filter(Boolean);
}

function extractTomlScalarKey(line) {
  const scalarMatch = line.trim().match(/^([^=\s]+)\s*=/);
  return scalarMatch?.[1] ?? null;
}

function readTomlSectionName(sectionBlock) {
  const firstLine = sectionBlock.split('\n')[0]?.trim() ?? '';
  const sectionMatch = firstLine.match(/^\[(.+)\]$/);
  return sectionMatch?.[1] ?? null;
}

function buildPrompt(repoRoot, options, scope, promptTemplate) {
  const scopeLine = options.mode === 'base'
    ? `- Review changes against base ref: ${options.target}, plus any current untracked worktree files so newly created local files are not missed before git add. Ignore obviously unrelated scratch or generated artifacts.`
    : options.mode === 'commit'
      ? `- Review only commit: ${options.target}.`
      : '- Review only the current uncommitted diff.';
  const changedFilesFence = buildMarkdownFence(
    scope.changedFiles.length > 0
      ? scope.changedFiles.map((filePath) => `- ${formatPromptFilePath(filePath)}`).join('\n')
      : '- (none)',
    'text',
  );
  const patchFence = buildMarkdownFence(scope.patch || '(empty patch)', 'diff');

  return [
    promptTemplate.trim(),
    '',
    'Review scope:',
    `- Repository root: ${repoRoot}`,
    scopeLine,
    '- Focus on correctness, regressions, and merge-blocking issues introduced by the diff.',
    '- Ignore style-only nits.',
    '',
    'Changed files:',
    changedFilesFence,
    '',
    'Patch to review:',
    patchFence,
  ].join('\n');
}

function buildMarkdownFence(content, infoString = '') {
  const longestBacktickRun = [...content.matchAll(/`+/g)]
    .reduce((maxLength, match) => Math.max(maxLength, match[0].length), 0);
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return [
    `${fence}${infoString}`,
    content,
    fence,
  ].join('\n');
}

async function loadTrustedReviewAssets(repoRoot, options) {
  return {
    promptTemplate: await readTrustedReviewAsset(repoRoot, options, 'prompts/review-agent-codex-exec.md'),
    outputSchema: await readTrustedReviewAsset(repoRoot, options, 'prompts/review-agent-output-schema.json'),
  };
}

async function readTrustedReviewAsset(repoRoot, options, relativePath) {
  const trustedBootstrapRefs = resolveTrustedBootstrapBaseRefs(repoRoot, options);
  const isReviewingLocalScriptRepo = repositoryMatchesScriptRepo(repoRoot);

  if (!isReviewingLocalScriptRepo) {
    const bundledTrustedAsset = await readBundledTrustedReviewAsset(relativePath, {
      sameRepoTrustOnly: false,
      allowWorkingTreeFallback: false,
      trustedBootstrapRefs,
    });
    if (bundledTrustedAsset !== null) {
      return bundledTrustedAsset;
    }

    throw new Error(`Could not resolve trusted review asset ${relativePath} without a committed baseline.`);
  }

  const trustedRevision = resolveTrustedReviewAssetRevision(repoRoot, options);
  const trustedMainlineTargetContent = options.mode === 'base' && isReviewingLocalScriptRepo && isTrustedBootstrapBaseRef(options.target, trustedBootstrapRefs)
    ? readGitFile(repoRoot, options.target, relativePath)
    : null;

  if (trustedMainlineTargetContent !== null) {
    return trustedMainlineTargetContent;
  }

  if (trustedRevision) {
    const trustedContent = readGitFile(repoRoot, trustedRevision, relativePath);
    if (trustedContent !== null) {
      return trustedContent;
    }

    const bundledTrustedAsset = await readBundledTrustedReviewAsset(relativePath, {
      sameRepoTrustOnly: isReviewingLocalScriptRepo,
      allowWorkingTreeFallback: false,
      trustedBootstrapRefs,
    });
    if (bundledTrustedAsset !== null) {
      return bundledTrustedAsset;
    }

    if (isReviewingLocalScriptRepo) {
      throw new Error(
        `Trusted review asset ${relativePath} was not present in ${trustedRevision}. Fetch origin/main (or another trusted mainline ref) so same-repo bootstrap review can fail closed against a mainline policy.`,
      );
    }

    throw new Error(`Trusted review asset ${relativePath} was not present in ${trustedRevision}.`);
  }

  const bundledTrustedAsset = await readBundledTrustedReviewAsset(relativePath, {
    sameRepoTrustOnly: true,
    allowWorkingTreeFallback: false,
    trustedBootstrapRefs,
  });
  if (bundledTrustedAsset !== null) {
    return bundledTrustedAsset;
  }

  throw new Error(
    `Could not resolve trusted review asset ${relativePath} without a committed baseline. Fetch origin/main (or another trusted mainline ref) so same-repo bootstrap review can fail closed against a mainline policy.`,
  );
}

async function readBundledTrustedReviewAsset(relativePath, options = {}) {
  for (const trustedRef of options.trustedBootstrapRefs ?? DEFAULT_TRUSTED_BOOTSTRAP_BASE_REFS) {
    const trustedMainlineAsset = readGitFile(scriptRepoRoot, trustedRef, relativePath);
    if (trustedMainlineAsset !== null) {
      return trustedMainlineAsset;
    }
  }

  if (options.sameRepoTrustOnly) {
    return null;
  }

  if (options.allowWorkingTreeFallback) {
    try {
      return await readFile(path.join(scriptRepoRoot, relativePath), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  return null;
}

function isTrustedBootstrapBaseRef(target, trustedBootstrapRefs = DEFAULT_TRUSTED_BOOTSTRAP_BASE_REFS) {
  const normalizedTarget = String(target ?? '').trim();
  if (!normalizedTarget || normalizedTarget === 'HEAD') {
    return false;
  }

  return trustedBootstrapRefs.has(normalizedTarget);
}

const DEFAULT_TRUSTED_BOOTSTRAP_BASE_REFS = new Set([
  'origin/main',
  'origin/master',
  'refs/remotes/origin/main',
  'refs/remotes/origin/master',
]);

const LOCAL_BOOTSTRAP_BASE_REFS = [
  'main',
  'master',
  'refs/heads/main',
  'refs/heads/master',
];

function isLocalBootstrapBaseRef(target) {
  return LOCAL_BOOTSTRAP_BASE_REFS.includes(String(target ?? '').trim());
}

function isLocalMainlineBootstrapTarget(target) {
  const normalizedTarget = String(target ?? '').trim();
  return normalizedTarget === 'HEAD' || isLocalBootstrapBaseRef(normalizedTarget);
}

function resolveTrustedBootstrapBaseRefs(repoRoot, options) {
  const trustedRefs = new Set(DEFAULT_TRUSTED_BOOTSTRAP_BASE_REFS);
  const shouldTrustLocalMainlineRefs = repositoryMatchesScriptRepo(repoRoot)
    && !hasCanonicalTrustedRemoteMainlineRef(scriptRepoRoot)
    && (options.mode !== 'base' || isLocalMainlineBootstrapTarget(options.target));

  if (!shouldTrustLocalMainlineRefs) {
    return trustedRefs;
  }

  for (const refName of LOCAL_BOOTSTRAP_BASE_REFS) {
    if (gitRefExists(scriptRepoRoot, refName)) {
      trustedRefs.add(refName);
    }
  }

  return trustedRefs;
}

function hasCanonicalTrustedRemoteMainlineRef(repoRoot) {
  return [...DEFAULT_TRUSTED_BOOTSTRAP_BASE_REFS].some((refName) => gitRefExists(repoRoot, refName));
}

function collectMatchingGitRefs(repoRoot, refPrefix) {
  const result = spawnSync('git', ['for-each-ref', '--format=%(refname)', refPrefix], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (result.status === 128) {
    return [];
  }

  if (result.status !== 0) {
    throw new Error(`Git command failed: git for-each-ref --format=%(refname) ${refPrefix}`);
  }

  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitRefExists(repoRoot, refName) {
  const result = spawnSync('git', ['rev-parse', '--verify', refName], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return result.status === 0;
}

function resolveTrustedReviewAssetRevision(repoRoot, options) {
  if (options.mode === 'base') {
    const mergeBase = runGit(repoRoot, ['merge-base', options.target, 'HEAD']).trim();
    if (repositoryMatchesScriptRepo(repoRoot)) {
      const trustedBootstrapRefs = resolveTrustedBootstrapBaseRefs(repoRoot, options);
      const currentHead = runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowedExitCodes: [0, 128] }).trim() || null;
      const isDegenerateSameHeadBase = currentHead !== null
        && mergeBase === currentHead
        && !isTrustedBootstrapBaseRef(options.target, trustedBootstrapRefs);
      if (isDegenerateSameHeadBase) {
        return null;
      }
    }

    return mergeBase;
  }

  if (options.mode === 'commit') {
    if (repositoryMatchesScriptRepo(repoRoot)) {
      // Same-repo commit review always bootstraps from trusted mainline refs
      // (including the local main/master fallback when no remote mainline ref
      // exists). Never trust branch-local parent assets for self-review.
      return null;
    }

    return runGit(repoRoot, ['rev-parse', '--verify', `${options.target}^`], { allowedExitCodes: [0, 128] }).trim() || null;
  }

  if (repositoryMatchesScriptRepo(repoRoot)) {
    return null;
  }

  return runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowedExitCodes: [0, 128] }).trim() || null;
}

function repositoryMatchesScriptRepo(repoRoot) {
  return normalizeComparablePath(repoRoot) === normalizeComparablePath(scriptRepoRoot);
}

function readGitFile(repoRoot, revision, relativePath) {
  const result = spawnSync('git', ['show', `${revision}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (result.status === 0) {
    return result.stdout ?? '';
  }

  if (result.status === 128) {
    return null;
  }

  throw new Error(`Git command failed: git show ${revision}:${relativePath}`);
}

function readGitIndexFile(repoRoot, relativePath) {
  const result = spawnSync('git', ['show', `:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (result.status === 0) {
    return result.stdout ?? '';
  }

  if (result.status === 128) {
    return null;
  }

  throw new Error(`Git command failed: git show :${relativePath}`);
}

function collectReviewScope(repoRoot, options, emptyFilePath) {
  if (options.mode === 'base') {
    const mergeBase = runGit(repoRoot, ['merge-base', options.target, 'HEAD']).trim();
    return mergeReviewScopes(
      {
        changedFiles: readGitLines(repoRoot, ['diff', '--name-only', '-z', mergeBase]),
        lineRangeExemptFiles: readGitLines(repoRoot, ['diff', '--name-only', '--diff-filter=D', '-z', mergeBase]),
        patch: runGit(repoRoot, ['diff', '--no-ext-diff', '--unified=3', mergeBase]),
      },
      collectUntrackedScope(repoRoot, emptyFilePath),
    );
  }

  if (options.mode === 'commit') {
    return {
      changedFiles: readGitLines(repoRoot, ['show', '-m', '--pretty=format:', '--name-only', '-z', options.target]),
      lineRangeExemptFiles: readGitLines(repoRoot, ['show', '-m', '--pretty=format:', '--name-only', '--diff-filter=D', '-z', options.target]),
      patch: runGit(repoRoot, ['show', '-m', '--pretty=format:', '--no-ext-diff', '--unified=3', options.target]),
    };
  }

  return collectUncommittedScope(repoRoot, emptyFilePath);
}

function readGitLines(repoRoot, args) {
  return runGit(repoRoot, args)
    .split('\0')
    .filter((line) => line.length > 0);
}

function runGit(repoRoot, args, options = {}) {
  const allowedExitCodes = options.allowedExitCodes ?? [0];
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (!allowedExitCodes.includes(result.status ?? -1)) {
    throw new Error(`Git command failed: git ${args.join(' ')}`);
  }

  return result.stdout ?? '';
}

function collectUncommittedScope(repoRoot, emptyFilePath) {
  const trackedBaseRef = resolveTrackedWorktreeBaseRef(repoRoot);
  return mergeReviewScopes(
    {
      changedFiles: readGitLines(repoRoot, ['diff', '--name-only', '-z', trackedBaseRef]),
      lineRangeExemptFiles: readGitLines(repoRoot, ['diff', '--name-only', '--diff-filter=D', '-z', trackedBaseRef]),
      patch: runGit(repoRoot, ['diff', '--no-ext-diff', '--unified=3', trackedBaseRef]).trim(),
    },
    collectUntrackedScope(repoRoot, emptyFilePath),
  );
}

function collectUntrackedScope(repoRoot, emptyFilePath) {
  const untrackedFiles = readGitLines(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  return {
    changedFiles: untrackedFiles,
    lineRangeExemptFiles: [],
    patch: untrackedFiles
      .map((filePath) => normalizeUntrackedPatch(
        filePath,
        runGit(repoRoot, ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', emptyFilePath, filePath], { allowedExitCodes: [0, 1] }).trim(),
      ))
      .filter(Boolean)
      .join('\n\n'),
  };
}

function mergeReviewScopes(...scopes) {
  const changedFiles = [];
  const seenFiles = new Set();
  const lineRangeExemptFiles = [];
  const seenLineRangeExemptFiles = new Set();
  const patchParts = [];

  for (const scope of scopes) {
    for (const filePath of scope.changedFiles ?? []) {
      if (!seenFiles.has(filePath)) {
        seenFiles.add(filePath);
        changedFiles.push(filePath);
      }
    }

    for (const filePath of scope.lineRangeExemptFiles ?? []) {
      if (!seenLineRangeExemptFiles.has(filePath)) {
        seenLineRangeExemptFiles.add(filePath);
        lineRangeExemptFiles.push(filePath);
      }
    }

    const patch = scope.patch?.trim();
    if (patch) {
      patchParts.push(patch);
    }
  }

  return {
    changedFiles,
    lineRangeExemptFiles,
    patch: patchParts.join('\n\n'),
  };
}

function resolveTrackedWorktreeBaseRef(repoRoot) {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return result.status === 0 ? 'HEAD' : EMPTY_TREE_HASH;
}

async function runStructuredReview({ cwd, isolatedCodexHome, outputPath, outputSchemaPath, prompt, timeoutMs }) {
  const childEnv = await buildChildEnv(isolatedCodexHome);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timeoutId = null;
    let killTimerId = null;
    const child = spawn(
      'codex',
      [
        'exec',
        '-s',
        'read-only',
        '-c',
        'approval_policy=never',
        '-c',
        'model_reasoning_effort="medium"',
        '-c',
        'features.multi_agent=false',
        '-c',
        'features.responses_websockets=false',
        '-c',
        'features.responses_websockets_v2=false',
        '--output-schema',
        outputSchemaPath,
        '--json',
        '--ephemeral',
        '-o',
        outputPath,
        '-',
      ],
      {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    const clearTimers = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (killTimerId) {
        clearTimeout(killTimerId);
        killTimerId = null;
      }
    };
    const rejectOnce = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      resolve(value);
    };

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimerId = setTimeout(() => {
          child.kill('SIGKILL');
        }, STRUCTURED_REVIEW_KILL_GRACE_MS);
      }, timeoutMs);
    }

    child.stdin.on('error', (error) => {
      if (error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED') {
        return;
      }

      rejectOnce(new Error('Structured review process failed before completion.'));
    });
    child.stdin.end(prompt);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      rejectOnce(new Error('Structured review process failed before completion.'));
    });

    child.on('close', async (code, signal) => {
      if (settled) {
        return;
      }

      if (timedOut && typeof timeoutMs === 'number') {
        rejectOnce(new Error(`Structured review process timed out after ${timeoutMs}ms.`));
        return;
      }

      if (signal) {
        rejectOnce(new Error(`Structured review process exited due to signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        rejectOnce(new Error(`Structured review process failed with exit code ${code}. ${stderr.trim()}`.trim()));
        return;
      }

      let lastMessage;
      try {
        lastMessage = await readFile(outputPath, 'utf8');
      } catch (error) {
        rejectOnce(new Error('Structured review did not produce an output payload.'));
        return;
      }

      resolveOnce({ lastMessage });
    });
  });
}

async function buildChildEnv(isolatedCodexHome) {
  const childEnv = { ...process.env, CODEX_HOME: isolatedCodexHome };
  const allowedCodexEnvKeys = await collectAllowedCodexEnvKeys(isolatedCodexHome);

  for (const key of Object.keys(childEnv)) {
    if (!key.startsWith('CODEX_') || allowedCodexEnvKeys.has(key)) {
      continue;
    }

    delete childEnv[key];
  }

  return childEnv;
}

async function collectAllowedCodexEnvKeys(isolatedCodexHome) {
  const allowedKeys = new Set(ALWAYS_ALLOWED_CODEX_ENV_KEYS);
  const isolatedConfigPath = path.join(isolatedCodexHome, 'config.toml');

  let configToml = '';
  try {
    configToml = await readFile(isolatedConfigPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  for (const match of configToml.matchAll(/^\s*env_key\s*=\s*(.+)$/gm)) {
    const rawValue = stripTomlInlineComment(match[1]?.trim() ?? null);
    const envKey = stripTomlQuotes(rawValue);
    if (typeof envKey === 'string' && envKey.startsWith('CODEX_')) {
      allowedKeys.add(envKey);
    }
  }

  return allowedKeys;
}

function tightenStructuredReviewSchema(schemaText) {
  try {
    const parsedSchema = JSON.parse(schemaText);
    const looksLikeStructuredReviewSchema = Array.isArray(parsedSchema?.required)
      && parsedSchema.required.includes('findings')
      && parsedSchema.required.includes('overall_explanation')
      && parsedSchema.required.includes('overall_correctness');

    if (!looksLikeStructuredReviewSchema) {
      return schemaText;
    }

    const tightenedSchema = {
      ...parsedSchema,
      properties: {
        ...parsedSchema.properties,
        overall_explanation: ensureSchemaStringMinLength(parsedSchema.properties?.overall_explanation),
        findings: {
          ...parsedSchema.properties?.findings,
          items: {
            ...parsedSchema.properties?.findings?.items,
            properties: {
              ...parsedSchema.properties?.findings?.items?.properties,
              title: ensureSchemaStringMinLength(parsedSchema.properties?.findings?.items?.properties?.title),
              body: ensureSchemaStringMinLength(parsedSchema.properties?.findings?.items?.properties?.body),
              code_location: {
                ...parsedSchema.properties?.findings?.items?.properties?.code_location,
                properties: {
                  ...parsedSchema.properties?.findings?.items?.properties?.code_location?.properties,
                  absolute_file_path: ensureSchemaStringMinLength(
                    parsedSchema.properties?.findings?.items?.properties?.code_location?.properties?.absolute_file_path,
                  ),
                },
              },
            },
          },
        },
      },
    };

    return `${JSON.stringify(tightenedSchema, null, 2)}\n`;
  } catch {
    return schemaText;
  }
}

function ensureSchemaStringMinLength(schemaFragment) {
  if (!schemaFragment || typeof schemaFragment !== 'object' || Array.isArray(schemaFragment)) {
    return schemaFragment;
  }

  if (schemaFragment.type !== 'string') {
    return schemaFragment;
  }

  return {
    ...schemaFragment,
    minLength: Math.max(1, Number.isFinite(schemaFragment.minLength) ? schemaFragment.minLength : 0),
  };
}

function parseStructuredReview(lastMessage, scope) {
  try {
    const parsed = parseStructuredReviewPayload(lastMessage);
    const normalizedRepoRoot = normalizeComparablePath(scope.repoRoot, scope.repoRoot);
    const allowedChangedFiles = new Set(scope.changedFiles.map((filePath) => normalizeComparablePath(filePath, scope.repoRoot)));
    const lineRangeExemptFiles = new Set((scope.lineRangeExemptFiles ?? []).map((filePath) => normalizeComparablePath(filePath, scope.repoRoot)));
    const renamedFilePathAliases = scope.renamedFilePathAliases ?? new Map();

    if (!hasOnlyAllowedKeys(parsed, REVIEW_PAYLOAD_KEYS)) {
      throw new Error('schema mismatch');
    }

    if (!Array.isArray(parsed.findings)) {
      throw new Error('schema mismatch');
    }

    if (
      typeof parsed.overall_explanation !== 'string' ||
      parsed.overall_explanation.length === 0 ||
      !isConfidenceScore(parsed.overall_confidence_score) ||
      (parsed.overall_correctness !== 'patch is correct' && parsed.overall_correctness !== 'patch is incorrect')
    ) {
      throw new Error('schema mismatch');
    }

    const expectedCorrectness = parsed.findings.length === 0 ? 'patch is correct' : 'patch is incorrect';
    if (parsed.overall_correctness !== expectedCorrectness) {
      throw new Error('contradictory findings count');
    }

    for (const finding of parsed.findings) {
      if (
        !hasOnlyAllowedKeys(finding, FINDING_KEYS) ||
        typeof finding?.title !== 'string' ||
        finding.title.length === 0 ||
        typeof finding?.body !== 'string' ||
        finding.body.length === 0 ||
        !isConfidenceScore(finding?.confidence_score) ||
        typeof finding?.priority !== 'string' ||
        !ALLOWED_PRIORITIES.has(finding.priority) ||
        !finding?.code_location
      ) {
        throw new Error('schema mismatch');
      }

      const absoluteFilePath = finding?.code_location?.absolute_file_path;
      const start = finding?.code_location?.line_range?.start;
      const end = finding?.code_location?.line_range?.end;
      if (
        !hasOnlyAllowedKeys(finding?.code_location, CODE_LOCATION_KEYS) ||
        !hasOnlyAllowedKeys(finding?.code_location?.line_range, LINE_RANGE_KEYS) ||
        typeof absoluteFilePath !== 'string' ||
        absoluteFilePath.trim().length === 0 ||
        !path.isAbsolute(absoluteFilePath) ||
        !isPositiveInteger(start) ||
        !isPositiveInteger(end)
      ) {
        throw new Error('schema mismatch');
      }

      if (end < start) {
        throw new Error('reversed line range');
      }

      const normalizedAbsoluteFilePath = normalizeComparablePath(absoluteFilePath, scope.repoRoot);
      const canonicalAbsoluteFilePath = renamedFilePathAliases.get(normalizedAbsoluteFilePath) ?? normalizedAbsoluteFilePath;
      if (
        !isPathWithinRoot(normalizedRepoRoot, normalizedAbsoluteFilePath) ||
        !allowedChangedFiles.has(canonicalAbsoluteFilePath)
      ) {
        throw new Error('schema mismatch');
      }

      const postImageHunkLineRanges = scope.postImageHunkLineRanges?.get(canonicalAbsoluteFilePath) ?? [];
      const deletedLineRanges = scope.deletedLineRanges?.get(canonicalAbsoluteFilePath) ?? [];
      const isDeletedFile = lineRangeExemptFiles.has(canonicalAbsoluteFilePath);
      const hasPostImageAnchor = lineRangeFallsWithinAllowedRanges(start, end, postImageHunkLineRanges);
      const hasDeletedLineAnchor = lineRangeFallsWithinAllowedRanges(start, end, deletedLineRanges);
      const isDeletedFileLevelStructuralFinding = isDeletedFile
        && deletedLineRanges.length === 0
        && start === 1
        && end === 1;
      const isFileLevelStructuralFinding = !isDeletedFile
        && postImageHunkLineRanges.length === 0
        && deletedLineRanges.length === 0
        && start === 1
        && end === 1;

      if (isDeletedFile && !hasDeletedLineAnchor && !isDeletedFileLevelStructuralFinding) {
        throw new Error('schema mismatch');
      }

      if (!isDeletedFile && !hasPostImageAnchor && !hasDeletedLineAnchor && !isFileLevelStructuralFinding) {
        throw new Error('schema mismatch');
      }
    }

    return parsed;
  } catch (error) {
    if (String(error.message ?? '').includes('contradictory findings count')) {
      throw new Error('Structured review payload contradicted its findings count.');
    }

    if (String(error.message ?? '').includes('reversed line range')) {
      throw new Error('Structured review payload had an invalid line range.');
    }

    if (String(error.message ?? '').includes('schema mismatch')) {
      throw new Error('Structured review payload did not match the required schema.');
    }

    throw new Error('Structured review payload was not valid JSON.');
  }
}

function parseStructuredReviewPayload(lastMessage) {
  try {
    return JSON.parse(lastMessage);
  } catch (error) {
    const candidate = lastMessage
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    if (candidate) {
      return JSON.parse(candidate);
    }

    throw error;
  }
}

function isPathWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function collectPostImageHunkLineRanges(repoRoot, patch) {
  const rangesByFile = new Map();
  let currentFile = null;
  let currentNormalizedFilePath = null;

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      currentFile = parsePatchedFilePath(line.slice(4));
      currentNormalizedFilePath = currentFile
        ? normalizeComparablePath(path.resolve(repoRoot, currentFile), repoRoot)
        : null;
      continue;
    }

    if (!currentFile || !currentNormalizedFilePath) {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const newStart = Number.parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] ? Number.parseInt(hunkMatch[4], 10) : 1;
      if (
        !Number.isInteger(newStart) ||
        !Number.isInteger(newCount) ||
        newCount < 0
      ) {
        continue;
      }

      if (newCount > 0) {
        const ranges = rangesByFile.get(currentNormalizedFilePath) ?? [];
        appendLineRange(ranges, newStart, newStart + newCount - 1);
        rangesByFile.set(currentNormalizedFilePath, ranges);
      } else {
        rangesByFile.set(currentNormalizedFilePath, rangesByFile.get(currentNormalizedFilePath) ?? []);
      }
    }
  }

  return rangesByFile;
}

function collectDeletedLineRanges(repoRoot, patch) {
  const rangesByFile = new Map();
  let currentOriginalFile = null;
  let currentPatchedFile = null;
  let currentNormalizedFilePath = null;
  let currentOldLine = null;
  let currentNewLine = null;

  for (const line of patch.split('\n')) {
    if (line.startsWith('--- ')) {
      currentOriginalFile = parseOriginalPatchedFilePath(line.slice(4));
      currentPatchedFile = null;
      currentNormalizedFilePath = currentOriginalFile
        ? normalizeComparablePath(path.resolve(repoRoot, currentOriginalFile), repoRoot)
        : null;
      currentOldLine = null;
      currentNewLine = null;
      continue;
    }

    if (line.startsWith('+++ ')) {
      currentPatchedFile = parsePatchedFilePath(line.slice(4));
      const deletedRangeAnchorPath = currentPatchedFile ?? currentOriginalFile;
      currentNormalizedFilePath = deletedRangeAnchorPath
        ? normalizeComparablePath(path.resolve(repoRoot, deletedRangeAnchorPath), repoRoot)
        : null;
      continue;
    }

    if (!currentOriginalFile || !currentNormalizedFilePath) {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const oldStart = Number.parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1;
      const newStart = Number.parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] ? Number.parseInt(hunkMatch[4], 10) : 1;
      if (
        !Number.isInteger(oldStart) ||
        !Number.isInteger(oldCount) ||
        oldCount < 0 ||
        !Number.isInteger(newStart) ||
        !Number.isInteger(newCount) ||
        newCount < 0
      ) {
        currentOldLine = null;
        currentNewLine = null;
        continue;
      }

      currentOldLine = oldStart;
      currentNewLine = newStart;
      rangesByFile.set(currentNormalizedFilePath, rangesByFile.get(currentNormalizedFilePath) ?? []);
      continue;
    }

    if (currentOldLine === null || currentNewLine === null) {
      continue;
    }

    const ranges = rangesByFile.get(currentNormalizedFilePath) ?? [];
    if (line.startsWith('-') && !line.startsWith('--- ')) {
      appendChangedLineRange(ranges, currentOldLine);
      currentOldLine += 1;
      rangesByFile.set(currentNormalizedFilePath, ranges);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++ ')) {
      currentNewLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      currentOldLine += 1;
      currentNewLine += 1;
    }
  }

  return rangesByFile;
}

function collectRenamedFilePathAliases(repoRoot, patch) {
  const renamedFilePathAliases = new Map();
  let currentOriginalFile = null;
  let currentRenamedFromFile = null;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentOriginalFile = null;
      currentRenamedFromFile = null;
      continue;
    }

    if (line.startsWith('rename from ')) {
      currentRenamedFromFile = unquoteGitPath(line.slice('rename from '.length));
      continue;
    }

    if (line.startsWith('rename to ')) {
      const currentRenamedToFile = unquoteGitPath(line.slice('rename to '.length));
      if (currentRenamedFromFile && currentRenamedToFile && currentRenamedFromFile !== currentRenamedToFile) {
        renamedFilePathAliases.set(
          normalizeComparablePath(path.resolve(repoRoot, currentRenamedFromFile), repoRoot),
          normalizeComparablePath(path.resolve(repoRoot, currentRenamedToFile), repoRoot),
        );
      }
      continue;
    }

    if (line.startsWith('--- ')) {
      currentOriginalFile = parseOriginalPatchedFilePath(line.slice(4));
      continue;
    }

    if (!line.startsWith('+++ ')) {
      continue;
    }

    const currentPatchedFile = parsePatchedFilePath(line.slice(4));
    if (!currentOriginalFile || !currentPatchedFile || currentOriginalFile === currentPatchedFile) {
      continue;
    }

    renamedFilePathAliases.set(
      normalizeComparablePath(path.resolve(repoRoot, currentOriginalFile), repoRoot),
      normalizeComparablePath(path.resolve(repoRoot, currentPatchedFile), repoRoot),
    );
  }

  return renamedFilePathAliases;
}

function appendChangedLineRange(ranges, lineNumber) {
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    return;
  }

  const lastRange = ranges.at(-1);
  if (lastRange && lineNumber <= lastRange.end + 1) {
    lastRange.end = Math.max(lastRange.end, lineNumber);
    return;
  }

  ranges.push({
    start: lineNumber,
    end: lineNumber,
  });
}

function appendLineRange(ranges, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return;
  }

  const lastRange = ranges.at(-1);
  if (lastRange && start <= lastRange.end + 1) {
    lastRange.end = Math.max(lastRange.end, end);
    return;
  }

  ranges.push({ start, end });
}

function parsePatchedFilePath(rawValue) {
  if (rawValue === '/dev/null') {
    return null;
  }

  const unquotedValue = unquoteGitPath(rawValue);
  if (!unquotedValue.startsWith('b/')) {
    return null;
  }

  return unquotedValue.slice(2);
}

function parseOriginalPatchedFilePath(rawValue) {
  if (rawValue === '/dev/null') {
    return null;
  }

  const unquotedValue = unquoteGitPath(rawValue);
  if (!unquotedValue.startsWith('a/')) {
    return null;
  }

  return unquotedValue.slice(2);
}

function unquoteGitPath(value) {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const bytes = [];
  for (let index = 1; index < value.length - 1; index += 1) {
    const currentChar = value[index];
    if (currentChar !== '\\') {
      bytes.push(...Buffer.from(currentChar, 'utf8'));
      continue;
    }

    index += 1;
    const escapedChar = value[index];
    if (escapedChar && isOctalDigit(escapedChar)) {
      let octalValue = escapedChar;
      while (octalValue.length < 3 && isOctalDigit(value[index + 1])) {
        index += 1;
        octalValue += value[index];
      }
      bytes.push(Number.parseInt(octalValue, 8));
    } else if (escapedChar === 'n') {
      bytes.push(0x0a);
    } else if (escapedChar === 'r') {
      bytes.push(0x0d);
    } else if (escapedChar === 't') {
      bytes.push(0x09);
    } else {
      bytes.push(...Buffer.from(escapedChar ?? '', 'utf8'));
    }
  }

  return Buffer.from(bytes).toString('utf8');
}

function lineRangeFallsWithinAllowedRanges(start, end, allowedRanges) {
  return allowedRanges.some((allowedRange) => start >= allowedRange.start && end <= allowedRange.end);
}

function normalizeComparablePath(filePath, rootPath = null) {
  const resolvedPath = rootPath && !path.isAbsolute(filePath) ? path.resolve(rootPath, filePath) : filePath;
  const normalizedPath = path.normalize(resolvedPath);

  if (!rootPath) {
    try {
      return path.normalize(realpathSync.native(resolvedPath));
    } catch {
      return normalizedPath;
    }
  }

  try {
    const normalizedRealRoot = path.normalize(realpathSync.native(rootPath));
    const normalizedRealPath = path.normalize(realpathSync.native(resolvedPath));
    const normalizedParentRealPath = path.normalize(realpathSync.native(path.dirname(resolvedPath)));
    const normalizedRepoLeafPath = path.normalize(path.join(normalizedParentRealPath, path.basename(resolvedPath)));
    const fileStats = lstatSync(resolvedPath);

    if (fileStats.isSymbolicLink()) {
      if (isPathWithinRoot(normalizedRealRoot, normalizedRepoLeafPath)) {
        return normalizedRepoLeafPath;
      }

      return normalizedRealPath;
    }

    if (isPathWithinRoot(normalizedRealRoot, normalizedRepoLeafPath)) {
      return normalizedRepoLeafPath;
    }

    return normalizedRealPath;
  } catch {
    if (rootPath) {
      try {
        const normalizedRealRoot = path.normalize(realpathSync.native(rootPath));
        const normalizedParentRealPath = path.normalize(realpathSync.native(path.dirname(resolvedPath)));
        const normalizedRepoLeafPath = path.normalize(path.join(normalizedParentRealPath, path.basename(resolvedPath)));
        if (isPathWithinRoot(normalizedRealRoot, normalizedRepoLeafPath)) {
          return normalizedRepoLeafPath;
        }
      } catch {
        // Fall through to the lexical absolute path when realpath data is unavailable.
      }
    }

    return normalizedPath;
  }
}

function isOctalDigit(value) {
  return typeof value === 'string' && value >= '0' && value <= '7';
}

function isConfidenceScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function hasOnlyAllowedKeys(value, allowedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  );
}

function stripTomlQuotes(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function stripTomlInlineComment(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      escaped = false;
      continue;
    }

    if (character === '"' && !inSingleQuote && !escaped) {
      inDoubleQuote = !inDoubleQuote;
      escaped = false;
      continue;
    }

    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index).trimEnd();
    }

    escaped = character === '\\' && inDoubleQuote && !escaped;
    if (character !== '\\') {
      escaped = false;
    }
  }

  return value.trimEnd();
}

function normalizeUntrackedPatch(filePath, rawPatch) {
  if (!rawPatch) {
    return rawPatch;
  }

  const quotedFilePath = formatGitPatchPath(filePath);

  return rawPatch
    .split('\n')
    .map((line, index) => {
      if (index === 0 && line.startsWith('diff --git ')) {
        return `diff --git ${quotedFilePath.a} ${quotedFilePath.b}`;
      }

      if (line.startsWith('--- ')) {
        return '--- /dev/null';
      }

      if (line.startsWith('+++ ')) {
        return `+++ ${quotedFilePath.b}`;
      }

      return line;
    })
    .join('\n');
}

function formatPromptFilePath(filePath) {
  return filePath
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
}

function formatGitPatchPath(filePath) {
  return {
    a: quoteGitPath(`a/${filePath}`),
    b: quoteGitPath(`b/${filePath}`),
  };
}

function quoteGitPath(value) {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('"', '\\"');

  return escaped === value ? value : `"${escaped}"`;
}

function printFindings(review, scope = {}) {
  for (const finding of review.findings) {
    const location = finding.code_location;
    const filePath = location?.absolute_file_path ?? 'unknown-file';
    const start = location?.line_range?.start ?? '?';
    const end = location?.line_range?.end ?? '?';
    const normalizedFilePath = typeof filePath === 'string' && path.isAbsolute(filePath)
      ? normalizeComparablePath(filePath, scope.repoRoot)
      : null;
    const canonicalNormalizedFilePath = normalizedFilePath
      ? scope.renamedFilePathAliases?.get(normalizedFilePath) ?? normalizedFilePath
      : null;
    const deletedLineRanges = canonicalNormalizedFilePath ? scope.deletedLineRanges?.get(canonicalNormalizedFilePath) ?? [] : [];
    const deletedLineAnchor = Number.isInteger(start)
      && Number.isInteger(end)
      && lineRangeFallsWithinAllowedRanges(start, end, deletedLineRanges);

    process.stdout.write(`[${finding.priority}] ${finding.title}\n`);
    process.stdout.write(`${filePath}:${start}-${end}${deletedLineAnchor ? ' (pre-image deleted lines)' : ''}\n`);
    process.stdout.write(`${finding.body}\n`);
  }
}

try {
  const trustedRunnerExitCode = await maybeRunTrustedSameRepoRunner(process.argv.slice(2));
  process.exitCode = trustedRunnerExitCode ?? await main();
} catch (error) {
  process.stdout.write(`${String(error.message ?? error)}\n`);
  process.exitCode = 2;
}
