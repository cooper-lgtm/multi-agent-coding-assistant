import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DefaultDebateSynthesizer,
  DefaultPlanningNormalizer,
  PlanningController,
  buildDirectPlanningFixtureRequest,
  buildDebatePlanningFixtureRequest,
  buildExecutionGuidancePlanningDraft,
  buildExecutionDag,
  validatePlanningResult,
} from '../dist/index.js';

test('planning pipeline produces a validated direct planning result and DAG', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan(buildDirectPlanningFixtureRequest());
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'direct');
  assert.equal(planningResult.tasks.length, 2);
  assert.ok(planningResult.tasks.every((task) =>
    task.assigned_agent === 'frontend-agent' || task.assigned_agent === 'backend-agent'));
  assert.ok(planningResult.tasks.every((task) =>
    task.assigned_agent !== 'test-agent' && task.assigned_agent !== 'review-agent'));
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.role),
    ['planning-agent'],
  );

  const dag = buildExecutionDag(planningResult);
  assert.equal(Object.keys(dag.graph.nodes).length, planningResult.tasks.length);
  assert.deepEqual(
    dag.graph.edges,
    [{ from: 'task-plan-contract', to: 'task-plan-ui' }],
  );
});

test('planning pipeline produces a synthesized debate planning result and DAG', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan(buildDebatePlanningFixtureRequest());
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'debate');
  assert.equal(planningResult.tasks.length, 3);
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.role),
    ['architecture-planner', 'engineering-planner', 'integration-planner'],
  );
  assert.equal(planningResult.planning_trace?.debate?.length, 3);
  assert.ok(planningResult.recommended_plan.includes('contract'));
  assert.ok(planningResult.recommended_plan.includes('integration'));

  const dag = buildExecutionDag(planningResult);
  assert.deepEqual(dag.graph.edges, [
    { from: 'task-plan-contract', to: 'task-plan-ui' },
    { from: 'task-plan-contract', to: 'task-plan-integration' },
    { from: 'task-plan-ui', to: 'task-plan-integration' },
  ]);
});

test('planning pipeline resolves auto to debate and preserves trace metadata', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  const planningResult = await controller.createPlan({
    ...buildDebatePlanningFixtureRequest(),
    planning_mode: 'auto',
  });
  validatePlanningResult(planningResult);

  assert.equal(planningResult.planning_mode, 'auto_resolved_debate');
  assert.deepEqual(
    planningResult.planning_trace?.planner_routes.map((route) => route.selected_model),
    ['claude', 'codex', 'gemini'],
  );
  assert.ok(
    planningResult.notes_for_orchestrator?.includes(
      'Synthesized from architecture-planner, engineering-planner, and integration-planner.',
    ),
  );
});

test('planning normalization rejects duplicate task ids before validation can collapse them', async () => {
  const controller = new PlanningController({
    availableModels: ['codex', 'claude', 'gemini'],
  });

  await assert.rejects(
    controller.createPlan({
      ...buildDirectPlanningFixtureRequest(),
      existing_artifacts: ['fixture:duplicate-task-id'],
    }),
    /Duplicate task id detected during planning normalization: task-plan-contract/,
  );
});

test('planning normalization preserves execution guidance through validation and DAG conversion', () => {
  const normalizer = new DefaultPlanningNormalizer();

  const planningResult = normalizer.normalize({
    request: buildDirectPlanningFixtureRequest(),
    resolved_mode: 'direct',
    draft: buildExecutionGuidancePlanningDraft(),
    planner_routes: [
      {
        role: 'planning-agent',
        selected_model: 'codex',
        attempted_models: ['codex'],
      },
    ],
  });

  validatePlanningResult(planningResult);

  assert.deepEqual(planningResult.tasks[0].execution_guidance, {
    must_read_files: ['README.md', 'src/schemas/planning.ts'],
    verification_commands: ['npm run build', 'node --test tests/planning-pipeline.test.mjs'],
    environment_checks: ['node -v', 'git status --short'],
    definition_of_done: [
      'Execution guidance is preserved on the normalized planning task.',
      'Execution guidance is present on the runtime task after DAG conversion.',
    ],
    reconsider_signals: [
      'Execution guidance is missing from the runtime task.',
      'Required verification commands are dropped during normalization.',
    ],
  });

  const dag = buildExecutionDag(planningResult);
  assert.deepEqual(dag.graph.nodes['task-plan-contract'].execution_guidance, planningResult.tasks[0].execution_guidance);
  assert.deepEqual(dag.runtime.tasks['task-plan-contract'].execution_guidance, planningResult.tasks[0].execution_guidance);
});

test('planning normalization preserves clarified brief and bounded coordination trace metadata', () => {
  const normalizer = new DefaultPlanningNormalizer();

  const planningResult = normalizer.normalize({
    request: buildDebatePlanningFixtureRequest(),
    resolved_mode: 'debate',
    draft: buildExecutionGuidancePlanningDraft(),
    planner_routes: [
      {
        role: 'planning-agent',
        selected_model: 'codex',
        attempted_models: ['codex'],
      },
    ],
    clarified_brief: {
      version: 1,
      request_summary: 'Implement the planning workspace with a coordinator-owned brief.',
      goals: ['Preserve a frozen brief for downstream analyzers.'],
      non_goals: ['Do not change debate execution order in this task.'],
      constraints: ['Keep planning outputs implementation-only.'],
      assumptions: ['The coordinator already resolved the initial user intent.'],
      known_risks: ['Later debate tasks may need richer analyzer-specific metadata.'],
      unresolved_questions: ['Should bounded cross-review metadata include per-role findings later?'],
      ready_for_planning: true,
    },
    clarification_rounds: 1,
    cross_review_rounds: 1,
  });

  validatePlanningResult(planningResult);

  assert.deepEqual(planningResult.planning_trace?.clarified_brief, {
    version: 1,
    request_summary: 'Implement the planning workspace with a coordinator-owned brief.',
    goals: ['Preserve a frozen brief for downstream analyzers.'],
    non_goals: ['Do not change debate execution order in this task.'],
    constraints: ['Keep planning outputs implementation-only.'],
    assumptions: ['The coordinator already resolved the initial user intent.'],
    known_risks: ['Later debate tasks may need richer analyzer-specific metadata.'],
    unresolved_questions: ['Should bounded cross-review metadata include per-role findings later?'],
    ready_for_planning: true,
  });
  assert.equal(planningResult.planning_trace?.clarification_rounds, 1);
  assert.equal(planningResult.planning_trace?.cross_review_rounds, 1);
});

test('planning normalization rejects coordination round counts above the bounded protocol', () => {
  const normalizer = new DefaultPlanningNormalizer();

  assert.throws(
    () => normalizer.normalize({
      request: buildDebatePlanningFixtureRequest(),
      resolved_mode: 'debate',
      draft: buildExecutionGuidancePlanningDraft(),
      planner_routes: [
        {
          role: 'planning-agent',
          selected_model: 'codex',
          attempted_models: ['codex'],
        },
      ],
      clarification_rounds: 2,
    }),
    /planning_trace\.clarification_rounds must be 0 or 1 when provided/,
  );

  assert.throws(
    () => normalizer.normalize({
      request: buildDebatePlanningFixtureRequest(),
      resolved_mode: 'debate',
      draft: buildExecutionGuidancePlanningDraft(),
      planner_routes: [
        {
          role: 'planning-agent',
          selected_model: 'codex',
          attempted_models: ['codex'],
        },
      ],
      cross_review_rounds: 2,
    }),
    /planning_trace\.cross_review_rounds must be 0 or 1 when provided/,
  );
});

test('planning normalization rejects malformed clarified brief booleans', () => {
  const normalizer = new DefaultPlanningNormalizer();

  assert.throws(
    () => normalizer.normalize({
      request: buildDebatePlanningFixtureRequest(),
      resolved_mode: 'debate',
      draft: buildExecutionGuidancePlanningDraft(),
      planner_routes: [
        {
          role: 'planning-agent',
          selected_model: 'codex',
          attempted_models: ['codex'],
        },
      ],
      clarified_brief: {
        version: 1,
        request_summary: 'Implement the planning workspace with a coordinator-owned brief.',
        goals: ['Preserve a frozen brief for downstream analyzers.'],
        non_goals: ['Do not change debate execution order in this task.'],
        constraints: ['Keep planning outputs implementation-only.'],
        assumptions: ['The coordinator already resolved the initial user intent.'],
        known_risks: ['Later debate tasks may need richer analyzer-specific metadata.'],
        unresolved_questions: ['Should bounded cross-review metadata include per-role findings later?'],
      },
    }),
    /planning_trace\.clarified_brief\.ready_for_planning must be a boolean/,
  );
});

test('planning result validation rejects invalid planning trace coordination metadata', () => {
  const normalizer = new DefaultPlanningNormalizer();

  const planningResult = normalizer.normalize({
    request: buildDebatePlanningFixtureRequest(),
    resolved_mode: 'debate',
    draft: buildExecutionGuidancePlanningDraft(),
    planner_routes: [
      {
        role: 'planning-agent',
        selected_model: 'codex',
        attempted_models: ['codex'],
      },
    ],
    clarified_brief: {
      version: 1,
      request_summary: 'Implement the planning workspace with a coordinator-owned brief.',
      goals: ['Preserve a frozen brief for downstream analyzers.'],
      non_goals: ['Do not change debate execution order in this task.'],
      constraints: ['Keep planning outputs implementation-only.'],
      assumptions: ['The coordinator already resolved the initial user intent.'],
      known_risks: ['Later debate tasks may need richer analyzer-specific metadata.'],
      unresolved_questions: ['Should bounded cross-review metadata include per-role findings later?'],
      ready_for_planning: true,
    },
    clarification_rounds: 1,
    cross_review_rounds: 1,
  });

  const invalidRounds = structuredClone(planningResult);
  invalidRounds.planning_trace.clarification_rounds = 2;
  assert.throws(
    () => validatePlanningResult(invalidRounds),
    /planning_trace\.clarification_rounds must be 0 or 1 when provided/,
  );

  const invalidBoolean = structuredClone(planningResult);
  invalidBoolean.planning_trace.clarified_brief.ready_for_planning = 'yes';
  assert.throws(
    () => validatePlanningResult(invalidBoolean),
    /planning_trace\.clarified_brief\.ready_for_planning must be a boolean/,
  );
});

test('debate synthesis preserves execution guidance introduced by later analyses', async () => {
  const synthesizer = new DefaultDebateSynthesizer();
  const normalizer = new DefaultPlanningNormalizer();
  const request = buildDebatePlanningFixtureRequest();

  const analyses = [
    {
      role: 'architecture-planner',
      planner_route: {
        role: 'architecture-planner',
        selected_model: 'claude',
        attempted_models: ['claude'],
      },
      epic: request.request,
      summary: 'Freeze the contract first.',
      recommended_plan: 'Start from architecture sequencing.',
      tasks: [
        {
          id: 'task-plan-contract',
          title: 'Lock planning contract',
          description: 'Define the backend planning contract.',
          assigned_agent: 'backend-agent',
          complexity: 'medium',
          risk: 'medium',
          depends_on: [],
          acceptance_criteria: ['The contract is defined before downstream work starts.'],
          quality_gate: {
            test_required: true,
            review_required: true,
            gate_reason: 'Contract changes must pass tests and review.',
          },
        },
      ],
    },
    {
      role: 'engineering-planner',
      planner_route: {
        role: 'engineering-planner',
        selected_model: 'codex',
        attempted_models: ['codex'],
      },
      epic: request.request,
      summary: 'Attach concrete execution guidance to the same contract task.',
      recommended_plan: 'Add execution guidance for the implementation worker.',
      tasks: [
        {
          id: 'task-plan-contract',
          title: 'Lock planning contract',
          description: 'Define the backend planning contract.',
          assigned_agent: 'backend-agent',
          complexity: 'medium',
          risk: 'medium',
          depends_on: [],
          acceptance_criteria: ['The task includes compact execution guidance for runtime use.'],
          quality_gate: {
            test_required: true,
            review_required: true,
            gate_reason: 'Contract changes must pass tests and review.',
          },
          execution_guidance: {
            must_read_files: ['README.md', 'src/schemas/planning.ts'],
            verification_commands: ['npm run build'],
            environment_checks: ['node -v'],
            definition_of_done: ['Execution guidance survives debate synthesis.'],
            reconsider_signals: ['Execution guidance is missing after synthesis.'],
          },
        },
      ],
    },
  ];

  const draft = await synthesizer.synthesize({
    request,
    resolved_mode: 'debate',
    available_models: ['codex', 'claude', 'gemini'],
    analyses,
  });

  const planningResult = normalizer.normalize({
    request,
    resolved_mode: 'debate',
    draft,
    planner_routes: analyses.map((analysis) => analysis.planner_route),
    debate: analyses,
  });

  validatePlanningResult(planningResult);

  assert.deepEqual(planningResult.tasks[0].execution_guidance, {
    must_read_files: ['README.md', 'src/schemas/planning.ts'],
    verification_commands: ['npm run build'],
    environment_checks: ['node -v'],
    definition_of_done: ['Execution guidance survives debate synthesis.'],
    reconsider_signals: ['Execution guidance is missing after synthesis.'],
  });

  const dag = buildExecutionDag(planningResult);
  assert.deepEqual(
    dag.runtime.tasks['task-plan-contract'].execution_guidance,
    planningResult.tasks[0].execution_guidance,
  );
});
