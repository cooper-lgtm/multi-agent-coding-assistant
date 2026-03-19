import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HELP_TEXT = `multi-agent-coding-assistant CLI

Usage:
  maca <command> [options]

Commands:
  plan      Run planning-only flow
  run       Run planning + orchestration execution
  resume    Resume a persisted run

Options:
  --repo-path <path>             Repository root for orchestration context
  --planning-mode <auto|direct|debate>
                                 Planning mode selection
  --execution-runtime <mock|goose>
                                 Implementation runtime adapter
  --output <json|text>           Output format
  --help                         Show this help
`;

export function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const command = args[0];
  if (!['plan', 'run', 'resume'].includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    return 1;
  }

  process.stdout.write(
    JSON.stringify(
      {
        command,
        status: 'not_implemented',
        message: 'CLI command wiring is scaffolded; orchestrator execution integration is pending.'
      },
      null,
      2
    ) + '\n'
  );

  return 0;
}

function isCliEntrypoint(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    return realpathSync(path.resolve(entryPath)) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return pathToFileURL(path.resolve(entryPath)).href === metaUrl;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  const exitCode = main(process.argv);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
