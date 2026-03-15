import type { RuntimeState } from '../schemas/runtime.js';

export interface RunStore {
  save(runtime: RuntimeState): Promise<void>;
  load(runId: string): Promise<RuntimeState | null>;
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RuntimeState>();

  async save(runtime: RuntimeState): Promise<void> {
    this.runs.set(runtime.run_id, structuredClone(runtime));
  }

  async load(runId: string): Promise<RuntimeState | null> {
    const runtime = this.runs.get(runId);
    return runtime ? structuredClone(runtime) : null;
  }
}
