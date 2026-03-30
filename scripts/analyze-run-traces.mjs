#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { analyzeRunTraces, renderRunTraceAnalysis } from '../dist/index.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stateDir = path.resolve(options.stateDir);
  const sources = await loadTraceSources(stateDir);

  if (sources.length === 0) {
    throw new Error(`No trace sources found under ${stateDir}`);
  }

  const analysis = analyzeRunTraces(sources);
  process.stdout.write(`${renderRunTraceAnalysis(analysis)}\n`);
}

function parseArgs(args) {
  const options = {
    stateDir: 'state',
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];

    switch (current) {
      case '--state-dir':
        options.stateDir = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return options;
}

async function loadTraceSources(rootDir) {
  const files = await collectFiles(rootDir);
  const eventLogFiles = files
    .filter((filePath) => path.basename(filePath) === 'events.jsonl')
    .sort();

  if (eventLogFiles.length > 0) {
    return Promise.all(eventLogFiles.map((filePath) => loadEventLogSource(rootDir, filePath)));
  }

  const jsonFiles = files
    .filter((filePath) => filePath.endsWith('.json'))
    .sort();
  const sources = await Promise.all(jsonFiles.map((filePath) => loadJsonSource(rootDir, filePath)));

  return sources.filter(Boolean);
}

async function collectFiles(targetPath) {
  const entries = await readdir(targetPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }

    if (entry.isFile()) {
      return [fullPath];
    }

    return [];
  }));

  return nestedFiles.flat();
}

async function loadEventLogSource(rootDir, filePath) {
  const content = await readFile(filePath, 'utf8');
  const events = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    source_id: normalizeSourceId(path.relative(rootDir, path.dirname(filePath))),
    events,
  };
}

async function loadJsonSource(rootDir, filePath) {
  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return {
      source_id: normalizeSourceId(path.relative(rootDir, filePath).replace(/\.json$/u, '')),
      events: parsed,
    };
  }

  if (parsed && Array.isArray(parsed.events)) {
    return {
      source_id: normalizeSourceId(path.relative(rootDir, path.dirname(filePath))),
      events: parsed.events,
    };
  }

  return null;
}

function normalizeSourceId(value) {
  return value === '' ? '.' : value.split(path.sep).join('/');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
