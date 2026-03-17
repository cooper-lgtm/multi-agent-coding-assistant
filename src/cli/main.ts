const HELP_TEXT = `multi-agent-coding-assistant CLI

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

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

function main(argv: string[]): number {
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

const exitCode = main(process.argv);
if (exitCode !== 0) {
  process.exit(exitCode);
}
