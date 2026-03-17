import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExecutionDag,
  InMemoryRunStore,
  MainOrchestrator,
  PolicyEngine,
  ReportingManager,
  RetryEscalationManager,
} from '../dist/index.js';

const baseTask = {
  assigned_agent: 'backend-agent',
  suggested_model: 'codex',
  complexity: 'medium',
  depends_on: [],
  acceptance_criteria: ['done'],
  quality_gate: {
    test_required: true,
    review_required: true,
    gate_reason: 'required',
  },
};

test('policy engine applies retry budgets, fallback chains, and dispatch limits', () => {
  const planningResult = {
    schema_version: '1',
    planning_mode: 'direct',
    epic: 'Policy controls',
    recommended_plan: 'apply policy guardrails',
    tasks: [
      {
        id: 'task-low-1',
        title: 'Low risk task one',
        description: 'run',
        risk: 'low',
        ...baseTask,
      },
      {
        id: 'task-high',
        title: 'High risk task',
        description: 'run',
        risk: 'high',
        ...baseTask,
      },
      {
        id: 'task-low-2',
        title: 'Low risk task two',
        description: 'run',
        risk: 'low',
        ...baseTask,
      },
    ],
  };

  const { runtime } = buildExecutionDag(planningResult, {
    maxRetriesPerTask: 5,
  });
  const policyEngine = new PolicyEngine();

  policyEngine.applyToRuntime(runtime, {
    budget_policy: {
      maxParallelTasks: 1,
      maxRetriesPerTask: 4,
      taskRetryBudgets: {
        'task-low-2': 1,
      },
      riskEscalationThreshold: 'high',
      roleFallbackPolicy: {
        'backend-agent': ['codex', 'claude'],
      },
    },
  });

  const dispatchable = policyEngine.selectDispatchableTasks(runtime);

  assert.deepEqual(dispatchable.map((task) => task.task_id), ['task-low-1']);
  assert.equal(runtime.tasks['task-high'].status, 'blocked');
  assert.match(runtime.tasks['task-high'].blocker_message ?? '', /manual review/i);
  assert.equal(runtime.tasks['task-low-2'].max_retries, 1);
  assert.deepEqual(runtime.tasks['task-low-1'].fallback_models, ['codex', 'claude']);
  assert.equal(runtime.policy_state?.max_parallel_tasks, 1);
  assert.equal(runtime.policy_state?.risk_escalation_threshold, 'high');
});

test('orchestrator blocks high-risk tasks before dispatching them', async () => {
  const planningResult = {
    schema_version: '1',
    planning_mode: 'direct',
    epic: 'Policy orchestration',
    recommended_plan: 'block risky work',
    tasks: [
      {
        id: 'task-low',
        title: 'Low risk task',
        description: 'run',
        risk: 'low',
        ...baseTask,
      },
      {
        id: 'task-high',
        title: 'High risk task',
        description: 'run',
        risk: 'high',
        ...baseTask,
      },
    ],
  };

  const dispatched = [];
  const orchestrator = new MainOrchestrator({
    createPlan: async () => planningResult,
    implementationDispatcher: {
      async dispatch(task) {
        dispatched.push(task.task_id);
        return {
          status: 'implementation_done',
          summary: `${task.task_id} complete`,
          changed_files: ['src/file.ts'],
          blocker_category: null,
          blocker_message: null,
          implementation_evidence: [],
          test_evidence: [],
          review_feedback: [],
          commands_run: [],
          test_results: [],
          risk_notes: [],
          suggested_status: null,
          delivery_metadata: null,
          prior_attempt: null,
        };
      },
    },
    qualityGateRunner: {
      async run() {
        return {
          status: 'completed',
          summary: 'gates pass',
          test_status: 'pass',
          review_status: 'approved',
          changed_files: [],
          blocker_category: null,
          blocker_message: null,
          implementation_evidence: [],
          test_evidence: [],
          review_feedback: [],
          commands_run: [],
          test_results: [],
          risk_notes: [],
          suggested_status: null,
          delivery_metadata: null,
          prior_attempt: null,
        };
      },
    },
    retryManager: new RetryEscalationManager(),
    reportingManager: new ReportingManager(),
    runStore: new InMemoryRunStore(),
    policyEngine: new PolicyEngine(),
  });

  const result = await orchestrator.run({
    request: 'do work',
    project_summary: 'summary',
    relevant_context: [],
    planning_mode: 'direct',
    constraints: [],
    budget_policy: {
      maxParallelTasks: 1,
      riskEscalationThreshold: 'high',
    },
  });

  assert.deepEqual(dispatched, ['task-low']);
  assert.equal(result.runtime.tasks['task-high'].status, 'blocked');
  assert.match(result.runtime.tasks['task-high'].blocker_message ?? '', /manual review/i);
  assert.equal(result.runtime.policy_state?.risk_escalation_threshold, 'high');
});

test('retry escalation respects task retry budgets and policy fallback chains', () => {
  const planningResult = {
    schema_version: '1',
    planning_mode: 'direct',
    epic: 'Retry policy',
    recommended_plan: 'retry with policy controls',
    tasks: [
      {
        id: 'task-1',
        title: 'Task 1',
        description: 'run',
        risk: 'low',
        ...baseTask,
      },
    ],
  };

  const { runtime } = buildExecutionDag(planningResult, {
    maxRetriesPerTask: 5,
  });
  const policyEngine = new PolicyEngine();

  policyEngine.applyToRuntime(runtime, {
    budget_policy: {
      taskRetryBudgets: {
        'task-1': 2,
      },
      roleFallbackPolicy: {
        'backend-agent': ['codex', 'claude'],
      },
    },
  });

  const task = runtime.tasks['task-1'];
  const retryManager = new RetryEscalationManager({
    availableModels: ['openai-codex/gpt-5.4', 'anthropic/claude-opus-4-6'],
  });

  task.retry_count = 1;
  task.model = 'codex';
  const decision = retryManager.decide(task, 'implementation_failed');

  assert.equal(task.max_retries, 2);
  assert.equal(decision.action, 'retry_with_upgraded_model');
  assert.equal(decision.next_model, 'claude');

  task.retry_count = 2;
  const exhausted = retryManager.decide(task, 'implementation_failed');
  assert.equal(exhausted.action, 'keep_terminal_status');
  assert.match(exhausted.reason, /retry budget exhausted/i);
});
