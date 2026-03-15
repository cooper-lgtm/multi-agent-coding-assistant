import type { PlanningResult } from '../schemas/planning.js';

export function buildDemoPlanningFixture(): PlanningResult {
  return {
    schema_version: '1.0.0',
    planning_mode: 'direct',
    epic: 'Demo orchestrator runtime',
    recommended_plan:
      'Implement the backend API contract, build the frontend shell on top of it, then wire the integration path.',
    tasks: [
      {
        id: 'task-api-contract',
        title: 'Implement API contract',
        description: 'Create the backend-facing contract that downstream tasks rely on.',
        assigned_agent: 'backend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: [],
        acceptance_criteria: [
          'Contract shape is documented in code.',
          'Implementation summary describes changed backend files.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Backend contract changes must be tested and reviewed.',
        },
      },
      {
        id: 'task-ui-shell',
        title: 'Build UI shell',
        description: 'Create the frontend shell that consumes the backend contract.',
        assigned_agent: 'frontend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: ['task-api-contract'],
        acceptance_criteria: [
          'UI shell uses the contract produced by the backend task.',
          'Summary identifies the frontend-facing change set.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Frontend shell changes need tests and review.',
        },
      },
      {
        id: 'task-integration-wireup',
        title: 'Wire end-to-end integration',
        description: 'Connect frontend and backend flows once both prerequisites are ready.',
        assigned_agent: 'backend-agent',
        complexity: 'high',
        risk: 'high',
        depends_on: ['task-api-contract', 'task-ui-shell'],
        acceptance_criteria: [
          'Integration only starts after the API contract and UI shell are complete.',
          'Summary confirms end-to-end wiring.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Integration work requires both tests and review.',
        },
      },
    ],
    parallel_groups: {},
    notes_for_orchestrator: [
      'This fixture contains implementation tasks only.',
      'Quality gates must be applied after implementation, not represented as DAG tasks.',
    ],
    risks: ['Integration wiring depends on a clean API contract handoff.'],
  };
}
