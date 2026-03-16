import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type RunManifest, type RuntimeControlState, type RuntimeEvent, type RuntimeState } from '../schemas/runtime.js';
import { buildRunManifest, type RunStore } from './run-store.js';

export interface FileBackedRunStoreOptions {
  stateDir?: string;
}

export class FileBackedRunStore implements RunStore {
  private readonly stateDir: string;

  constructor(options: FileBackedRunStoreOptions = {}) {
    this.stateDir = path.resolve(options.stateDir ?? 'state');
  }

  async save(runtime: RuntimeState): Promise<void> {
    const runDir = this.getRunDir(runtime.run_id);
    await mkdir(runDir, { recursive: true });

    const manifest = buildRunManifest(runtime);

    await this.writeJsonAtomic(path.join(runDir, 'runtime.json'), runtime);
    await this.writeJsonAtomic(path.join(runDir, 'manifest.json'), manifest);
    await this.persistEventLog(path.join(runDir, 'events.jsonl'), runtime.events);
  }

  async load(runId: string): Promise<RuntimeState | null> {
    return this.readJsonFile<RuntimeState>(path.join(this.getRunDir(runId), 'runtime.json'));
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
    return this.readJsonFile<RunManifest>(path.join(this.getRunDir(runId), 'manifest.json'));
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
    const runtime = await this.load(runId);

    if (!runtime) {
      throw new Error(`Unknown run: ${runId}`);
    }

    runtime.control = {
      ...runtime.control,
      ...patch,
    };
    runtime.updated_at = new Date().toISOString();
    await this.save(runtime);
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
}
