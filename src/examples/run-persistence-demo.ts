import path from 'node:path';

import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import { FileBackedRunStore } from '../storage/file-backed-run-store.js';
import {
  MockImplementationDispatcher,
  type ImplementationDispatchResult,
} from '../orchestrator/implementation-dispatcher.js';
import { MainOrchestrator } from '../orchestrator/main-orchestrator.js';
import { MockQualityGateRunner } from '../orchestrator/quality-gate-runner.js';
import { ReportingManager } from '../orchestrator/reporting-manager.js';
import { RetryEscalationManager } from '../orchestrator/retry-escalation-manager.js';
import { buildDemoPlanningFixture } from './planning-fixtures.js';

class PauseAfterFirstDispatch extends MockImplementationDispatcher {
  private hasRequestedPause = false;

  constructor(private readonly runStore: FileBackedRunStore) {
    super();
  }

  async dispatch(task: ExecutionNode, runtime: RuntimeState): Promise<ImplementationDispatchResult> {
    const result = await super.dispatch(task, runtime);

    if (!this.hasRequestedPause) {
      this.hasRequestedPause = true;
      await this.runStore.requestPause(runtime.run_id);
    }

    return result;
  }
}

const runStore = new FileBackedRunStore();
const orchestrator = new MainOrchestrator({
  createPlan: async () => buildDemoPlanningFixture(),
  implementationDispatcher: new PauseAfterFirstDispatch(runStore),
  qualityGateRunner: new MockQualityGateRunner(),
  retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
  reportingManager: new ReportingManager(),
  runStore,
});

const request = {
  request: 'Demonstrate durable persistence and checkpoint resume.',
  project_summary: 'Show a file-backed orchestrator run that pauses and resumes from disk.',
  relevant_context: ['Persist artifacts under state/runs/<run-id>/.'],
  planning_mode: 'direct' as const,
  constraints: ['Keep the demo deterministic and local-only.'],
};

const pausedRun = await orchestrator.run(request);
const runId = pausedRun.runtime.run_id;
const runDir = path.resolve('state', 'runs', runId);
const pausedManifest = await runStore.loadManifest(runId);

console.log(`Paused run ${runId} with status ${pausedRun.summary.final_status}.`);
console.log(`Artifacts written to ${runDir}`);
console.log(`Manifest status: ${pausedManifest?.status}`);
console.log(`Task checkpoint: ${pausedRun.runtime.tasks['task-api-contract'].status}`);

const resumedRun = await orchestrator.resume(runId);
const finalManifest = await runStore.loadManifest(runId);
const events = await runStore.loadEvents(runId);

console.log(`Resumed run ${runId} to status ${resumedRun.summary.final_status}.`);
console.log(`Final manifest status: ${finalManifest?.status}`);
console.log(`Persisted events: ${events.length}`);
