import type { WorkerRetryHandoff } from '../workers/contracts.js';
import type { RuntimeMiddleware } from './runtime-middleware.js';

const LOOP_DETECTION_MIDDLEWARE_NAME = 'loop-detection';
const LOOP_DETECTION_EVENT_TYPE = 'retry_loop_detected';

export function createLoopDetectionMiddleware(): RuntimeMiddleware {
  return {
    name: LOOP_DETECTION_MIDDLEWARE_NAME,
    beforeDispatch({ task, runtime }) {
      const detection = detectRepeatedLowYieldPattern(task.attempt_history ?? []);

      if (!detection) {
        return;
      }

      task.repeated_pattern_summary = detection.summary;
      task.reconsider_instructions = uniqueStrings([
        ...task.reconsider_instructions,
        ...detection.reconsider_instructions,
      ]);

      const message = `Retry loop detected for ${task.task_id}: ${detection.summary}`;
      const alreadyRecorded = runtime.events.some((event) =>
        event.type === LOOP_DETECTION_EVENT_TYPE &&
        event.task_id === task.task_id &&
        event.message === message,
      );

      if (alreadyRecorded) {
        return;
      }

      runtime.events.push({
        timestamp: new Date().toISOString(),
        task_id: task.task_id,
        type: LOOP_DETECTION_EVENT_TYPE,
        message,
      });
    },
  };
}

interface LoopDetectionResult {
  summary: string;
  reconsider_instructions: string[];
}

function detectRepeatedLowYieldPattern(history: WorkerRetryHandoff[]): LoopDetectionResult | null {
  const recentAttempts = history.slice(-2);

  if (recentAttempts.length < 2) {
    return null;
  }

  const [previousAttempt, latestAttempt] = recentAttempts;
  const repeatedFailure = hasRepeatedFailure(previousAttempt, latestAttempt);
  const repeatedChangedFiles = sameStringSet(previousAttempt.changed_files, latestAttempt.changed_files);
  const unchangedVerificationEvidence =
    sameStringSet(previousAttempt.commands_run, latestAttempt.commands_run) &&
    sameStringSet(previousAttempt.test_evidence, latestAttempt.test_evidence);

  if (!repeatedFailure || !repeatedChangedFiles || !unchangedVerificationEvidence) {
    return null;
  }

  const summary = `Attempts ${previousAttempt.attempt} and ${latestAttempt.attempt} repeated the same ${describeRepeatedFailure(latestAttempt)} on unchanged files with no new verification evidence.`;

  return {
    summary,
    reconsider_instructions: uniqueStrings([
      'Change approach before editing the same files again.',
      latestAttempt.blocker_message
        ? `Start from the repeated blocker: ${latestAttempt.blocker_message}`
        : 'Re-read the latest blocker or review feedback before retrying.',
      ...latestAttempt.reconsider_instructions,
    ]),
  };
}

function hasRepeatedFailure(previousAttempt: WorkerRetryHandoff, latestAttempt: WorkerRetryHandoff): boolean {
  if (
    previousAttempt.failure_category &&
    latestAttempt.failure_category &&
    previousAttempt.failure_category === latestAttempt.failure_category
  ) {
    return true;
  }

  if (
    previousAttempt.blocker_message &&
    latestAttempt.blocker_message &&
    previousAttempt.blocker_message === latestAttempt.blocker_message
  ) {
    return true;
  }

  return false;
}

function describeRepeatedFailure(attempt: WorkerRetryHandoff): string {
  if (attempt.blocker_message && /review/i.test(attempt.blocker_message)) {
    return 'review blocker';
  }

  if (attempt.blocker_message) {
    return 'blocker';
  }

  if (attempt.failure_category) {
    return attempt.failure_category.replaceAll('_', ' ');
  }

  return 'failure pattern';
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftItems = uniqueStrings(left);
  const rightItems = uniqueStrings(right);

  if (leftItems.length !== rightItems.length) {
    return false;
  }

  return leftItems.every((value) => rightItems.includes(value));
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
