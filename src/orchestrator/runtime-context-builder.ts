import fs from 'node:fs';
import path from 'node:path';

import type { ExecutionGuidance } from '../schemas/planning.js';
import type { ExecutionNode } from '../schemas/runtime.js';
import {
  getWorkerAttemptNumber,
  type WorkerEnvironmentSnapshot,
  type WorkerRetryContextSummary,
  type WorkerRetryHandoff,
  type WorkerRuntimeContext,
} from '../workers/contracts.js';
import { discoverLocalExecutionHints } from './local-context-discovery.js';

const DEFAULT_REPO_CONTEXT_PATH = 'docs/context/repo-context.md';
const REPO_CONTEXT_SUMMARY_LIMIT = 8;

const EMPTY_EXECUTION_GUIDANCE: ExecutionGuidance = {
  must_read_files: [],
  verification_commands: [],
  environment_checks: [],
  definition_of_done: [],
  reconsider_signals: [],
};

export interface RuntimeContextBuilderInput {
  repoPath: string;
  task: Pick<
    ExecutionNode,
    | 'execution_guidance'
    | 'prior_attempt'
    | 'attempt_history'
    | 'retry_count'
    | 'max_retries'
    | 'reconsider_instructions'
    | 'repeated_pattern_summary'
  >;
  discovery?: WorkerEnvironmentSnapshot;
  repoContextPath?: string;
}

export function buildRuntimeContextPackage(input: RuntimeContextBuilderInput): WorkerRuntimeContext {
  const repoContextPath = input.repoContextPath ?? DEFAULT_REPO_CONTEXT_PATH;
  const guidance = input.task.execution_guidance ?? EMPTY_EXECUTION_GUIDANCE;
  const priorAttempt = input.task.prior_attempt ?? null;

  return {
    repo_context_summary: readRepoContextSummary(input.repoPath, repoContextPath),
    environment_snapshot: cloneEnvironmentSnapshot(
      input.discovery ?? discoverLocalExecutionHints(input.repoPath),
    ),
    task_context_files: collectTaskContextFiles(input.repoPath, repoContextPath, guidance.must_read_files),
    verification_plan: {
      commands: uniqueStrings(guidance.verification_commands),
      environment_checks: uniqueStrings(guidance.environment_checks),
      definition_of_done: uniqueStrings(guidance.definition_of_done),
      reconsider_signals: buildReconsiderSignals(
        guidance.reconsider_signals,
        uniqueStrings(input.task.reconsider_instructions ?? []),
        input.task.repeated_pattern_summary ?? null,
        priorAttempt,
      ),
      retry_handoff: summarizeRetryHandoff(priorAttempt),
    },
    time_budget_hint: buildTimeBudgetHint(getWorkerAttemptNumber(input.task), input.task.max_retries),
  };
}

function readRepoContextSummary(repoPath: string, repoContextPath: string): string[] {
  const absolutePath = path.join(repoPath, repoContextPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/u);
  const summary: string[] = [];
  let currentSection = '';

  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/.exec(line.trim());
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (!shouldIncludeRepoContextSection(currentSection)) {
      continue;
    }

    const bulletMatch = /^\s*-\s+(.*)$/.exec(line);
    if (!bulletMatch) {
      continue;
    }

    const normalized = normalizeSummaryLine(bulletMatch[1]);
    if (!normalized) {
      continue;
    }

    summary.push(normalized);
    if (summary.length >= REPO_CONTEXT_SUMMARY_LIMIT) {
      break;
    }
  }

  return summary;
}

function shouldIncludeRepoContextSection(sectionName: string): boolean {
  return sectionName.startsWith('Current Baseline') || sectionName.startsWith('PR / Workflow Rules');
}

function normalizeSummaryLine(line: string): string {
  return line
    .replaceAll('`', '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function collectTaskContextFiles(
  repoPath: string,
  repoContextPath: string,
  mustReadFiles: string[],
): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  if (fs.existsSync(path.join(repoPath, repoContextPath))) {
    pushUnique(files, seen, repoContextPath);
  }

  for (const file of mustReadFiles) {
    pushUnique(files, seen, file);
  }

  return files;
}

function buildReconsiderSignals(
  signals: string[],
  reconsiderInstructions: string[],
  repeatedPatternSummary: string | null,
  priorAttempt: WorkerRetryHandoff | null,
): string[] {
  const items = uniqueStrings([...signals, ...reconsiderInstructions]);

  if (repeatedPatternSummary) {
    items.push(repeatedPatternSummary);
  }

  if (priorAttempt?.summary) {
    items.push(`Prior attempt ${priorAttempt.attempt} ended as ${priorAttempt.status}: ${priorAttempt.summary}`);
  }

  if (priorAttempt?.blocker_message) {
    items.push(`Previous blocker: ${priorAttempt.blocker_message}`);
  }

  if (priorAttempt?.failure_diagnosis) {
    items.push(`Previous diagnosis: ${priorAttempt.failure_diagnosis}`);
  }

  if (priorAttempt?.repeated_pattern_summary) {
    items.push(priorAttempt.repeated_pattern_summary);
  }

  return uniqueStrings(items);
}

function summarizeRetryHandoff(priorAttempt: WorkerRetryHandoff | null): WorkerRetryContextSummary | null {
  if (!priorAttempt) {
    return null;
  }

  return {
    attempt: priorAttempt.attempt,
    status: priorAttempt.status,
    summary: priorAttempt.summary,
    blocker_category: priorAttempt.blocker_category,
    blocker_message: priorAttempt.blocker_message,
    failure_category: priorAttempt.failure_category,
    failure_diagnosis: priorAttempt.failure_diagnosis,
    reconsider_instructions: uniqueStrings(priorAttempt.reconsider_instructions ?? []),
    repeated_pattern_summary: priorAttempt.repeated_pattern_summary ?? null,
    checklist_feedback: uniqueStrings(priorAttempt.checklist_feedback ?? []),
    commands_run: uniqueStrings(priorAttempt.commands_run),
    review_feedback: uniqueStrings(priorAttempt.review_feedback),
  };
}

function buildTimeBudgetHint(currentAttempt: number, maxRetries: number): string {
  const totalAttempts = maxRetries + 1;
  const retriesRemaining = Math.max(totalAttempts - currentAttempt, 0);
  const retrySuffix = retriesRemaining === 1 ? 'retry remains' : 'retries remain';

  return `Attempt ${currentAttempt} of ${totalAttempts}; ${retriesRemaining} ${retrySuffix} after this pass.`;
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function pushUnique(target: string[], seen: Set<string>, value: string): void {
  const normalized = value.trim();
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
}

function cloneEnvironmentSnapshot(snapshot: WorkerEnvironmentSnapshot): WorkerEnvironmentSnapshot {
  return {
    package_manager: snapshot.package_manager,
    package_manifest_path: snapshot.package_manifest_path,
    lockfile_path: snapshot.lockfile_path,
    build_command: snapshot.build_command,
    test_commands: [...snapshot.test_commands],
  };
}
