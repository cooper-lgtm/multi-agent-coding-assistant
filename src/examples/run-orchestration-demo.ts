import { MainOrchestrator } from '../orchestrator/main-orchestrator.js';
import { MockImplementationDispatcher } from '../orchestrator/implementation-dispatcher.js';
import { MockQualityGateRunner } from '../orchestrator/quality-gate-runner.js';
import { RetryEscalationManager } from '../orchestrator/retry-escalation-manager.js';
import { ReportingManager } from '../orchestrator/reporting-manager.js';
import { InMemoryRunStore } from '../storage/run-store.js';
import { buildDemoPlanningFixture } from './planning-fixtures.js';

const orchestrator = new MainOrchestrator({
  createPlan: async () => buildDemoPlanningFixture(),
  implementationDispatcher: new MockImplementationDispatcher({
    taskDecisions: {
      'task-api-contract': [
        { status: 'failed', summary: 'First backend implementation pass failed validation.' },
        { status: 'failed', summary: 'Second backend implementation pass failed on the same model.' },
        { status: 'implementation_done', summary: 'Backend implementation succeeded after retry.' },
      ],
    },
  }),
  qualityGateRunner: new MockQualityGateRunner(),
  retryManager: new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
  reportingManager: new ReportingManager(),
  runStore: new InMemoryRunStore(),
});

const result = await orchestrator.run({
  request: 'Run the orchestrator runtime demo',
  project_summary: 'Demonstrate the runtime loop with mock adapters.',
  relevant_context: ['Use the built-in planning fixture.'],
  planning_mode: 'direct',
  constraints: ['Keep prompts English-only.'],
});

console.log(`Run ${result.summary.run_id} finished with status ${result.summary.final_status}.`);
for (const task of result.summary.tasks) {
  console.log(
    `- ${task.task_id}: ${task.status} via ${task.assigned_agent} on ${task.model}${
      task.model_metadata ? ` -> ${task.model_metadata.exact_model_id}` : ''
    } (retries=${task.retry_count})`,
  );
  console.log(`  changed files: ${task.changed_files.join(', ') || '(none)'}`);
  console.log(`  blocker: ${task.blocker_category ?? 'none'} / ${task.blocker_message ?? 'n/a'}`);
  console.log(`  prior attempt: ${task.prior_attempt?.summary ?? 'none'}`);
  console.log(`  implementation evidence: ${task.implementation_evidence.join(' | ') || '(none)'}`);
  console.log(`  test evidence: ${task.test_evidence.join(' | ') || '(none)'}`);
  console.log(`  review feedback: ${task.review_feedback.join(' | ') || '(none)'}`);
}
console.log(
  `Counts: completed=${result.summary.counts.completed}, needs_fix=${result.summary.counts.needs_fix}, blocked=${result.summary.counts.blocked}, failed=${result.summary.counts.failed}, pending=${result.summary.counts.pending}`,
);
