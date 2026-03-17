import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDirectPlanningFixture,
  buildDemoPlanningFixture,
  GooseBackedImplementationDispatcher,
  InMemoryRunStore,
  MainOrchestrator,
  MockQualityGateRunner,
  ReportingManager,
  RetryEscalationManager,
} from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXED_NOW = 1700000000000;

function loadJsonFixture(...segments) {
  const fixturePath = path.join(FIXTURES_DIR, ...segments);
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function createGooseDispatcher(taskDecisions = {}) {
  return new GooseBackedImplementationDispatcher({
    repoPath: '/tmp/example-repo',
    executeRole: async (request) => {
      const taskId = request.payload.task.task_id;
      const sequence = taskDecisions[taskId] ?? [];
      const attempt = request.payload.runtime.retry_count ?? 0;
      const selected = sequence[Math.min(attempt, Math.max(sequence.length - 1, 0))] ?? {
        status: 'implementation_done',
        summary: `Goose implemented ${taskId}.`,
      };

      return {
        ok: true,
        run_id: request.run_id,
        role: request.role,
        model: request.model,
        summary: selected.summary,
        output: {
          role: request.role,
          status: selected.status,
          summary: selected.summary,
          changed_files: selected.changed_files ?? [`src/goose/${taskId}.ts`],
          blocker_category: selected.blocker_category ?? null,
          blocker_message: selected.blocker_message ?? null,
          implementation_evidence: selected.implementation_evidence ?? [selected.summary],
          test_evidence: selected.test_evidence ?? [],
          review_feedback: selected.review_feedback ?? [],
          commands_run: selected.commands_run ?? ['npm run build'],
          test_results: selected.test_results ?? [],
          risk_notes: selected.risk_notes ?? [],
          suggested_status: selected.suggested_status ?? selected.status,
          delivery_metadata: selected.delivery_metadata ?? {
            branch_name: `feat/${taskId}`,
            commit_sha: 'abc1234',
            pr_url: `https://example.invalid/pr/${taskId}`,
          },
          prior_attempt: request.payload.prior_attempt ?? null,
        },
      };
    },
  });
}

function buildGoldenRuntimeSnapshot(summary) {
  return {
    run_id: summary.run_id,
    epic: summary.epic,
    final_status: summary.final_status,
    counts: summary.counts,
    tasks: summary.tasks.map((task) => ({
      task_id: task.task_id,
      status: task.status,
      assigned_agent: task.assigned_agent,
      model: task.model,
      retry_count: task.retry_count,
      test_status: task.test_status,
      review_status: task.review_status,
      blocker_category: task.blocker_category,
      blocker_message: task.blocker_message,
      commands_run: task.commands_run,
      test_evidence: task.test_evidence,
      review_feedback: task.review_feedback,
      delivery_metadata: task.delivery_metadata,
      prior_attempt: task.prior_attempt,
    })),
    events: summary.events,
  };
}

async function withFixedRunId(runScenario) {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;

  try {
    return await runScenario();
  } finally {
    Date.now = originalNow;
  }
}

async function runGooseScenario(options = {}) {
  const fixture = buildDemoPlanningFixture();
  const orchestrator = new MainOrchestrator({
    createPlan: async () => fixture,
    implementationDispatcher: createGooseDispatcher(options.implementationTaskDecisions),
    qualityGateRunner: new MockQualityGateRunner({
      taskDecisions: options.qualityTaskDecisions ?? {},
    }),
    retryManager:
      options.retryManager ?? new RetryEscalationManager({ availableModels: ['codex', 'claude'] }),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
  });

  return withFixedRunId(() =>
    orchestrator.run({
      request: 'demo',
      project_summary: 'demo',
      relevant_context: [],
      planning_mode: 'direct',
      constraints: [],
      budget_policy: options.budget_policy,
    }),
  );
}

test('direct planning fixture stays aligned with the golden planning snapshot', () => {
  const golden = loadJsonFixture('planning', 'direct-plan-golden.json');

  assert.deepEqual(buildDirectPlanningFixture(), golden);
});

test('goose-backed happy path completes end to end', async () => {
  const result = await runGooseScenario();

  assert.equal(result.summary.final_status, 'completed');
  assert.deepEqual(result.summary.counts, {
    completed: 3,
    needs_fix: 0,
    blocked: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
  });
  assert.deepEqual(
    result.summary.tasks.map((task) => [task.task_id, task.status]),
    [
      ['task-api-contract', 'completed'],
      ['task-ui-shell', 'completed'],
      ['task-integration-wireup', 'completed'],
    ],
  );
});

test('goose implementation failures can recover on retry without losing runtime evidence', async () => {
  const result = await runGooseScenario({
    implementationTaskDecisions: {
      'task-api-contract': [
        {
          status: 'failed',
          summary: 'Goose hit a transient implementation error.',
          blocker_category: 'environment',
          blocker_message: 'Temporary execution environment issue.',
        },
        {
          status: 'implementation_done',
          summary: 'Recovered implementation after retry.',
          commands_run: ['npm run build', 'npm run test:runtime'],
        },
      ],
    },
  });

  const task = result.runtime.tasks['task-api-contract'];
  assert.equal(result.summary.final_status, 'completed');
  assert.equal(task.retry_count, 1);
  assert.equal(task.prior_attempt?.status, 'failed');
  assert.match(task.prior_attempt?.summary ?? '', /transient implementation error/i);
  assert.ok(task.commands_run.includes('npm run test:runtime'));
});

test('external review needs-fix scenario matches the golden runtime snapshot', async () => {
  const result = await runGooseScenario({
    qualityTaskDecisions: {
      'task-api-contract': [
        {
          status: 'needs_fix',
          summary: 'Review requested changes.',
          test_status: 'pass',
          review_status: 'needs_fix',
          review_feedback: ['review-agent requested changes for task-api-contract on claude.'],
        },
        {
          status: 'needs_fix',
          summary: 'Review still requests changes.',
          test_status: 'pass',
          review_status: 'needs_fix',
          review_feedback: ['review-agent still requests changes for task-api-contract on claude.'],
        },
        {
          status: 'needs_fix',
          summary: 'Retry budget exhausted.',
          test_status: 'pass',
          review_status: 'needs_fix',
          review_feedback: ['Retry budget exhausted.'],
        },
      ],
    },
  });
  const golden = loadJsonFixture('runtime', 'goose-needs-fix-golden.json');

  assert.deepEqual(buildGoldenRuntimeSnapshot(result.summary), golden);
});

test('repository prerequisite blockers match the golden runtime snapshot', async () => {
  const result = await runGooseScenario({
    implementationTaskDecisions: {
      'task-api-contract': [
        {
          status: 'blocked',
          summary: 'Repository prerequisites are missing.',
          blocker_category: 'repository',
          blocker_message: 'Required repository prerequisites are missing for goose execution.',
        },
      ],
    },
  });
  const golden = loadJsonFixture('runtime', 'goose-blocked-golden.json');

  assert.deepEqual(buildGoldenRuntimeSnapshot(result.summary), golden);
});
