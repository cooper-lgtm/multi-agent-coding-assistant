import type { PlanningRequest } from '../schemas/planning.js';
import type { RuntimeApprovalState, RuntimeState } from '../schemas/runtime.js';

export class ApprovalManager {
  initialize(runtime: RuntimeState, request: PlanningRequest): RuntimeApprovalState {
    const now = new Date().toISOString();
    const mode = request.execution_control?.mode ?? 'auto-execute';

    return {
      mode,
      status: mode === 'confirm-before-run' ? 'waiting_for_approval' : 'auto_approved',
      requested_at: now,
      approved_at: mode === 'auto-execute' ? now : null,
      approved_by: null,
    };
  }

  canExecute(runtime: RuntimeState): boolean {
    if (!runtime.approval_state) {
      return true;
    }

    return runtime.approval_state.status !== 'waiting_for_approval';
  }

  markAwaitingApproval(runtime: RuntimeState): void {
    if (!runtime.approval_state) {
      return;
    }

    runtime.status = 'paused';
    runtime.control = {
      ...runtime.control,
      pause_requested: false,
    };
  }

  markApprovedForResume(runtime: RuntimeState): void {
    if (!runtime.approval_state) {
      return;
    }

    if (runtime.approval_state.status === 'approved' || runtime.approval_state.status === 'auto_approved') {
      return;
    }

    runtime.approval_state = {
      ...runtime.approval_state,
      status: 'approved',
      approved_at: runtime.approval_state.approved_at ?? new Date().toISOString(),
    };
  }
}
