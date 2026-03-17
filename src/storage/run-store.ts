import {
  countTaskStatuses,
  type RunManifest,
  type RuntimeApprovalState,
  type RuntimeControlState,
  type RuntimeEvent,
  type RuntimeState,
} from '../schemas/runtime.js';

export interface RunApprovalUpdate {
  approved_by: string;
  approved_at?: string;
}

export interface RunStore {
  save(runtime: RuntimeState): Promise<void>;
  load(runId: string): Promise<RuntimeState | null>;
  listRuns(): Promise<RunManifest[]>;
  loadManifest(runId: string): Promise<RunManifest | null>;
  loadEvents(runId: string): Promise<RuntimeEvent[]>;
  approveRun(runId: string, approval: RunApprovalUpdate): Promise<void>;
  requestPause(runId: string): Promise<void>;
  requestCancel(runId: string): Promise<void>;
}

export function buildRunManifest(runtime: RuntimeState, lastPersistedAt = runtime.updated_at): RunManifest {
  return {
    schema_version: runtime.storage_version,
    run_id: runtime.run_id,
    epic: runtime.epic,
    planning_mode: runtime.graph.planning_mode,
    status: runtime.status,
    created_at: runtime.created_at,
    updated_at: runtime.updated_at,
    last_persisted_at: lastPersistedAt,
    task_counts: countTaskStatuses(runtime.tasks),
    control: { ...runtime.control },
    approval_state: runtime.approval_state ? cloneApprovalState(runtime.approval_state) : null,
    artifacts: {
      runtime_snapshot: 'runtime.json',
      event_log: 'events.jsonl',
    },
  };
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

  async listRuns(): Promise<RunManifest[]> {
    return [...this.runs.values()]
      .map((runtime) => buildRunManifest(runtime))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async loadManifest(runId: string): Promise<RunManifest | null> {
    const runtime = this.runs.get(runId);
    return runtime ? buildRunManifest(runtime) : null;
  }

  async loadEvents(runId: string): Promise<RuntimeEvent[]> {
    const runtime = this.runs.get(runId);
    return runtime ? structuredClone(runtime.events) : [];
  }

  async approveRun(runId: string, approval: RunApprovalUpdate): Promise<void> {
    const runtime = this.runs.get(runId);

    if (!runtime) {
      throw new Error(`Unknown run: ${runId}`);
    }

    runtime.approval_state = {
      mode: runtime.approval_state?.mode ?? 'confirm-before-run',
      status: 'approved',
      requested_at: runtime.approval_state?.requested_at ?? new Date().toISOString(),
      approved_at: approval.approved_at ?? new Date().toISOString(),
      approved_by: approval.approved_by,
    };
    runtime.updated_at = new Date().toISOString();
  }

  async requestPause(runId: string): Promise<void> {
    this.updateControl(runId, { pause_requested: true });
  }

  async requestCancel(runId: string): Promise<void> {
    this.updateControl(runId, { cancel_requested: true });
  }

  private updateControl(runId: string, patch: Partial<RuntimeControlState>): void {
    const runtime = this.runs.get(runId);

    if (!runtime) {
      throw new Error(`Unknown run: ${runId}`);
    }

    runtime.control = {
      ...runtime.control,
      ...patch,
    };
    runtime.updated_at = new Date().toISOString();
  }
}

function cloneApprovalState(approvalState: RuntimeApprovalState): RuntimeApprovalState {
  return {
    mode: approvalState.mode,
    status: approvalState.status,
    requested_at: approvalState.requested_at,
    approved_at: approvalState.approved_at,
    approved_by: approvalState.approved_by,
  };
}
