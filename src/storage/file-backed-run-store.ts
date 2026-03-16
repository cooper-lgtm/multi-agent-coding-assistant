import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type RunManifest, type RuntimeControlState, type RuntimeEvent, type RuntimeState } from '../schemas/runtime.js';
import { buildRunManifest, type RunStore } from './run-store.js';

export interface FileBackedRunStoreOptions {
  stateDir?: string;
}

export class FileBackedRunStore implements RunStore {
  private readonly stateDir: string;
  private readonly runWriteQueues = new Map<string, Promise<void>>();

  constructor(options: FileBackedRunStoreOptions = {}) {
    this.stateDir = path.resolve(options.stateDir ?? 'state');
  }

  async save(runtime: RuntimeState): Promise<void> {
    await this.withRunWriteLock(runtime.run_id, async () => {
      const runDir = this.getRunDir(runtime.run_id);
      await mkdir(runDir, { recursive: true });

      const existingManifest = await this.readManifest(runtime.run_id);
      const persistedRuntime = structuredClone(runtime);
      persistedRuntime.control = this.resolvePersistedControl(runtime, existingManifest);

      const manifest = buildRunManifest(persistedRuntime);

      await this.writeJsonAtomic(path.join(runDir, 'runtime.json'), persistedRuntime);
      await this.writeJsonAtomic(path.join(runDir, 'manifest.json'), manifest);
      await this.persistEventLog(path.join(runDir, 'events.jsonl'), persistedRuntime.events);

      runtime.control = { ...persistedRuntime.control };
    });
  }

  async load(runId: string): Promise<RuntimeState | null> {
    const runtime = await this.readJsonFile<RuntimeState>(path.join(this.getRunDir(runId), 'runtime.json'));

    if (!runtime) {
      return null;
    }

    const manifest = await this.readManifest(runId);
    if (manifest) {
      runtime.control = { ...manifest.control };
    }

    return runtime;
  }

  async listRuns(): Promise<RunManifest[]> {
    const runsDir = path.join(this.stateDir, 'runs');
    let entries: string[];

    try {
      entries = await readdir(runsDir);
    } catch {
      return [];
    }

    const manifests = await Promise.all(entries.map((entry) => this.loadManifest(entry)));

    return manifests
      .filter((manifest): manifest is RunManifest => manifest !== null)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async loadManifest(runId: string): Promise<RunManifest | null> {
    return this.readManifest(runId);
  }

  async loadEvents(runId: string): Promise<RuntimeEvent[]> {
    const eventsPath = path.join(this.getRunDir(runId), 'events.jsonl');
    let content: string;

    try {
      content = await readFile(eventsPath, 'utf8');
    } catch {
      return [];
    }

    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeEvent);
  }

  async requestPause(runId: string): Promise<void> {
    await this.updateControl(runId, { pause_requested: true });
  }

  async requestCancel(runId: string): Promise<void> {
    await this.updateControl(runId, { cancel_requested: true });
  }

  private async updateControl(runId: string, patch: Partial<RuntimeControlState>): Promise<void> {
    await this.withRunWriteLock(runId, async () => {
      const manifest = await this.readManifest(runId);

      if (!manifest) {
        throw new Error(`Unknown run: ${runId}`);
      }

      const now = new Date().toISOString();
      const nextManifest: RunManifest = {
        ...manifest,
        updated_at: now,
        last_persisted_at: now,
        control: {
          ...manifest.control,
          ...patch,
        },
      };

      await this.writeJsonAtomic(path.join(this.getRunDir(runId), 'manifest.json'), nextManifest);
    });
  }

  private resolvePersistedControl(runtime: RuntimeState, manifest: RunManifest | null): RuntimeControlState {
    if (!manifest) {
      return { ...runtime.control };
    }

    if (
      manifest.status === 'paused' &&
      runtime.status === 'running' &&
      !runtime.control.pause_requested &&
      !runtime.control.cancel_requested
    ) {
      return { ...runtime.control };
    }

    return {
      pause_requested: runtime.control.pause_requested || manifest.control.pause_requested,
      cancel_requested: runtime.control.cancel_requested || manifest.control.cancel_requested,
    };
  }

  private async persistEventLog(eventsPath: string, events: RuntimeEvent[]): Promise<void> {
    const serializedEvents = events.map((event) => JSON.stringify(event));

    if (serializedEvents.length === 0) {
      await this.writeTextAtomic(eventsPath, '');
      return;
    }

    const existingEvents = await this.loadSerializedEvents(eventsPath);
    if (this.isPrefix(existingEvents, serializedEvents)) {
      const missingEvents = serializedEvents.slice(existingEvents.length);

      if (missingEvents.length > 0) {
        await appendFile(eventsPath, `${missingEvents.join('\n')}\n`, 'utf8');
      }

      return;
    }

    await this.writeTextAtomic(eventsPath, `${serializedEvents.join('\n')}\n`);
  }

  private async loadSerializedEvents(eventsPath: string): Promise<string[]> {
    try {
      const content = await readFile(eventsPath, 'utf8');
      return content
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private isPrefix(existing: string[], next: string[]): boolean {
    if (existing.length > next.length) {
      return false;
    }

    return existing.every((line, index) => line === next[index]);
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private async readManifest(runId: string): Promise<RunManifest | null> {
    return this.readJsonFile<RunManifest>(path.join(this.getRunDir(runId), 'manifest.json'));
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await this.writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  private async writeTextAtomic(filePath: string, value: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;

    await writeFile(tempPath, value, 'utf8');
    await rename(tempPath, filePath);
  }

  private getRunDir(runId: string): string {
    return path.join(this.stateDir, 'runs', runId);
  }

  private async withRunWriteLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runWriteQueues.get(runId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);

    this.runWriteQueues.set(runId, queued);
    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      releaseCurrent();

      if (this.runWriteQueues.get(runId) === queued) {
        this.runWriteQueues.delete(runId);
      }
    }
  }
}
