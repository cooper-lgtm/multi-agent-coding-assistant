import type { RuntimeMiddleware } from './runtime-middleware.js';

const CHECKLIST_MIDDLEWARE_NAME = 'pre-completion-checklist';
const CONTINUATION_MESSAGE =
  'Missing required verification evidence before external quality gates. Run the missing commands and return explicit evidence.';

export function createPreCompletionChecklistMiddleware(): RuntimeMiddleware {
  return {
    name: CHECKLIST_MIDDLEWARE_NAME,
    beforeQualityGates({ task }) {
      const requiredCommands = uniqueStrings(task.execution_guidance?.verification_commands ?? []);

      if (requiredCommands.length === 0) {
        task.checklist_feedback = [];
        return;
      }

      const commandsRun = uniqueStrings(task.commands_run ?? []);
      const missingCommands = requiredCommands.filter((command) =>
        !commandsRun.some((executedCommand) => matchesVerificationCommand(command, executedCommand)),
      );

      if (missingCommands.length === 0) {
        task.checklist_feedback = [];
        return;
      }

      task.checklist_feedback = missingCommands.map((command) =>
        `Missing verification evidence for required command: ${command}`,
      );

      return {
        action: 'continue_task',
        message: CONTINUATION_MESSAGE,
      };
    },
  };
}

function matchesVerificationCommand(requiredCommand: string, executedCommand: string): boolean {
  return executedCommand === requiredCommand || executedCommand.startsWith(`${requiredCommand} `);
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
