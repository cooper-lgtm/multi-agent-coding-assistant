import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildDemoPlanningFixture,
  FileBackedRunStore,
  MainOrchestrator,
  MockImplementationDispatcher,
  MockQualityGateRunner,
  ReportingManager,
  RetryEscalationManager,
} from '../dist/index.js';

function buildRequest(overrides = {}) {
  return {
    request: 'Implement approval controls',
    project_summary: 'approval controls runtime',
    relevant_context: ['runtime controls'],
    planning_mode: 'direct',
    constraints: [],
    ...overrides,
  };
}

function buildStateDir(name) {
  return path.join('.tmp-state-approval', `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function buildIndependentPlan() {
  const fixture = buildDemoPlanningFixture();
  const [template] = fixture.tasks;

  return {
    ...fixture,
    epic: 'Approval control summary plan',
    tasks: [
      {
        ...template,
        id: 'task-blocked',
        title: 'Blocked task',
        description: 'Task that should remain blocked.',
        depends_on: [],
      },
      {
        ...template,
        id: 'task-failed',
        title: 'Failed task',
        description: 'Task that should exhaust retries.',
        depends_on: [],
      },
    ],
  };
}

test('confirm-before-run pauses after planning and persists waiting approval state', async () => {
  const runStore = new FileBackedRunStore({ stateDir: buildStateDir('confirm-before-run') });
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run(buildRequest({ execution_control: { mode: 'confirm-before-run' } }));

  assert.equal(result.runtime.status, 'paused');
  assert.equal(result.runtime.approval_state?.status, 'waiting_for_approval');
  assert.equal(result.runtime.approval_state?.mode, 'confirm-before-run');
  assert.equal(result.runtime.approval_state?.approved_by, null);
  assert.equal(result.summary.final_status, 'paused');
  assert.equal(result.summary.approval_state?.status, 'waiting_for_approval');

  const persisted = await runStore.load(result.runtime.run_id);
  assert.ok(persisted);
  assert.equal(persisted.approval_state?.status, 'waiting_for_approval');

  const manifest = await runStore.loadManifest(result.runtime.run_id);
  assert.ok(manifest);
  assert.equal(manifest.approval_state?.status, 'waiting_for_approval');

  const events = await runStore.loadEvents(result.runtime.run_id);
  assert.ok(events.some((event) => event.type === 'awaiting_human_approval'));
});

test('auto-execute does not wait for approval and completes run', async () => {
  const runStore = new FileBackedRunStore({ stateDir: buildStateDir('auto-execute') });
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run(buildRequest({ execution_control: { mode: 'auto-execute' } }));

  assert.equal(result.runtime.status, 'completed');
  assert.equal(result.runtime.approval_state?.status, 'auto_approved');
  assert.equal(result.summary.final_status, 'completed');
  assert.equal(result.summary.approval_state?.status, 'auto_approved');
});

test('resume executes after explicit approval while preserving approval metadata', async () => {
  const runStore = new FileBackedRunStore({ stateDir: buildStateDir('resume-after-approval') });
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const initial = await orchestrator.run(buildRequest({ execution_control: { mode: 'confirm-before-run' } }));
  await runStore.approveRun(initial.runtime.run_id, { approved_by: 'human-reviewer' });

  const resumed = await orchestrator.resume(initial.runtime.run_id);

  assert.equal(resumed.runtime.status, 'completed');
  assert.equal(resumed.runtime.approval_state?.status, 'approved');
  assert.equal(resumed.runtime.approval_state?.approved_by, 'human-reviewer');
  assert.equal(resumed.runtime.approval_state?.approved_at !== null, true);
});

test('resume honors cancel requests before re-entering waiting-for-approval state', async () => {
  const runStore = new FileBackedRunStore({ stateDir: buildStateDir('cancel-before-approval') });
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildDemoPlanningFixture(),
    implementationDispatcher: new MockImplementationDispatcher(),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const initial = await orchestrator.run(buildRequest({ execution_control: { mode: 'confirm-before-run' } }));
  await runStore.requestCancel(initial.runtime.run_id);

  const resumed = await orchestrator.resume(initial.runtime.run_id);

  assert.equal(resumed.runtime.status, 'cancelled');
  assert.equal(resumed.summary.final_status, 'cancelled');
  assert.equal(resumed.runtime.control.cancel_requested, true);
  assert.ok(Object.values(resumed.runtime.tasks).every((task) => task.status === 'cancelled'));
});

test('summary exposes blocked and repeated-failure escalation paths', async () => {
  const runStore = new FileBackedRunStore({ stateDir: buildStateDir('summary') });
  const orchestrator = new MainOrchestrator({
    createPlan: async () => buildIndependentPlan(),
    implementationDispatcher: new MockImplementationDispatcher({
      taskDecisions: {
        'task-blocked': [
          {
            status: 'blocked',
            summary: 'Missing environment precondition.',
            blocker_category: 'environment',
            blocker_message: 'Credential not configured.',
            implementation_evidence: ['Precondition check failed.'],
          },
        ],
        'task-failed': [
          { status: 'failed', summary: 'Implementation crashed unexpectedly.' },
          { status: 'failed', summary: 'Implementation crashed again on retry.' },
          { status: 'failed', summary: 'Retry budget exhausted after repeated failures.' },
        ],
      },
    }),
    qualityGateRunner: new MockQualityGateRunner(),
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore,
  });

  const result = await orchestrator.run(buildRequest({ execution_control: { mode: 'auto-execute' } }));

  assert.equal(result.summary.final_status, 'failed');
  assert.ok(result.summary.events.some((event) => event.includes('blocked')));
  assert.ok(result.summary.events.some((event) => event.includes('Retry budget exhausted')));
});
