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
    return this.runs.get(runId) ?? null;
  }
}
