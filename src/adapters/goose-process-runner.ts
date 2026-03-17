import { spawn } from 'node:child_process';

export interface GooseProcessInvocation {
  recipe_path: string;
  output_schema_path: string;
  inputs: Record<string, unknown>;
  cwd?: string;
}

export interface GooseProcessResult {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
}

export function buildGooseProcessArgs(invocation: GooseProcessInvocation): string[] {
  const args = ['run', '--recipe', invocation.recipe_path, '--quiet', '--no-session'];

  for (const [key, value] of Object.entries(invocation.inputs)) {
    args.push('--params', `${key}=${serializeGooseParam(value)}`);
  }

  return args;
}

export async function runGooseProcess(invocation: GooseProcessInvocation): Promise<GooseProcessResult> {
  const args = buildGooseProcessArgs(invocation);

  return new Promise((resolve) => {
    const child = spawn('goose', args, {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        exit_code: 1,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      resolve({
        ok: exitCode === 0,
        exit_code: exitCode,
        stdout,
        stderr,
      });
    });
  });
}

function serializeGooseParam(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
