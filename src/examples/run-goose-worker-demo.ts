import { GooseWorkerAdapter } from '../adapters/goose-worker-adapter.js';
import { MainOrchestrator } from '../orchestrator/main-orchestrator.js';
import { GooseBackedImplementationDispatcher } from '../orchestrator/implementation-dispatcher.js';
import { MockQualityGateRunner } from '../orchestrator/quality-gate-runner.js';
import { RetryEscalationManager } from '../orchestrator/retry-escalation-manager.js';
import { ReportingManager } from '../orchestrator/reporting-manager.js';
import { InMemoryRunStore } from '../storage/run-store.js';
import { buildDemoPlanningFixture } from './planning-fixtures.js';

const gooseAdapter = new GooseWorkerAdapter({
  runGoose: async (invocation) => {
    const task = invocation.inputs.task as { task_id?: string };
    const taskId = task.task_id ?? 'unknown-task';

    return {
      ok: true,
      exit_code: 0,
      stdout: JSON.stringify({
        status: 'implementation_done',
        summary: `Goose implementation completed for ${taskId}.`,
        changed_files: [`src/goose/${taskId}.ts`],
        blocker_category: null,
        blocker_message: null,
        implementation_evidence: [`Stub goose run produced implementation evidence for ${taskId}.`],
        test_evidence: [],
        review_feedback: [],
        commands_run: ['npm run build', 'node --test tests/orchestrator-goose-runtime.test.mjs'],
        test_results: [{ name: 'tests/orchestrator-goose-runtime.test.mjs', status: 'pass' }],
        risk_notes: ['Demo adapter uses a stubbed goose process runner.'],
        suggested_status: 'implementation_done',
        delivery_metadata: {
          branch_name: `feat/${taskId}`,
          commit_sha: 'demo1234',
          pr_url: `https://example.invalid/pr/${taskId}`,
        },
      }),
      stderr: '',
    };
  },
});

const orchestrator = new MainOrchestrator({
  createPlan: async () => buildDemoPlanningFixture(),
  implementationDispatcher: new GooseBackedImplementationDispatcher({
    executeRole: gooseAdapter.execute.bind(gooseAdapter),
    repoPath: process.cwd(),
  }),
  qualityGateRunner: new MockQualityGateRunner(),
  retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
  reportingManager: new ReportingManager(),
  runStore: new InMemoryRunStore(),
});

const result = await orchestrator.run({
  request: 'Run the goose-backed worker demo',
  project_summary: 'Demonstrate implementation dispatch through the goose adapter seam.',
  relevant_context: ['Use the built-in planning fixture and stub goose execution.'],
  planning_mode: 'direct',
  constraints: ['Keep quality gates external to the goose implementation adapter.'],
});

console.log(`Run ${result.summary.run_id} finished with status ${result.summary.final_status}.`);
for (const task of result.summary.tasks) {
  console.log(
    `- ${task.task_id}: ${task.status} via ${task.assigned_agent} on ${task.model} (retries=${task.retry_count})`,
  );
  console.log(`  commands: ${task.commands_run.join(' | ') || '(none)'}`);
  console.log(`  delivery: ${task.delivery_metadata?.branch_name ?? 'n/a'} / ${task.delivery_metadata?.pr_url ?? 'n/a'}`);
  console.log(`  implementation evidence: ${task.implementation_evidence.join(' | ') || '(none)'}`);
  console.log(`  test evidence: ${task.test_evidence.join(' | ') || '(none)'}`);
  console.log(`  review feedback: ${task.review_feedback.join(' | ') || '(none)'}`);
}
