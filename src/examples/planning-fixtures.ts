import type { PlanningRequest, PlanningResult } from '../schemas/planning.js';

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

export function buildDirectPlanningFixtureRequest(): PlanningRequest {
  return {
    request: 'Deliver a planning preview panel backed by a stable plan contract.',
    project_summary: 'Small planning feature that needs a backend contract and a frontend surface.',
    relevant_context: [
      'The UI should render data from a backend plan contract.',
    ],
    planning_mode: 'direct',
    constraints: [
      'Keep the scope to implementation tasks only.',
      'Quality gates remain outside planning ownership.',
    ],
  };
}

export function buildDirectPlanningFixture(): PlanningResult {
  return {
    schema_version: '1.0.0',
    planning_mode: 'direct',
    epic: 'Deliver a planning preview panel backed by a stable plan contract.',
    recommended_plan: 'Lock the plan contract first, then build the plan UI.',
    tasks: [
      {
        id: 'task-plan-contract',
        title: 'Lock planning contract',
        description: 'Define the backend planning contract that downstream UI work depends on.',
        assigned_agent: 'backend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: [],
        acceptance_criteria: [
          'The planning contract shape is explicit and stable for downstream consumers.',
          'Implementation notes identify the backend contract surface.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Contract changes must pass tests and review before downstream work starts.',
        },
      },
      {
        id: 'task-plan-ui',
        title: 'Build planning UI flow',
        description: 'Build the frontend planning UI against the locked backend contract.',
        assigned_agent: 'frontend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: ['task-plan-contract'],
        acceptance_criteria: [
          'The UI reads from the contract produced by task-plan-contract.',
          'Implementation notes identify the frontend change surface.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'UI changes must pass tests and review before integration handoff.',
        },
      },
    ],
    notes_for_orchestrator: ['Direct planning stayed on implementation tasks only.'],
    risks: ['UI delivery depends on the contract staying stable after the backend task.'],
    planning_trace: {
      requested_mode: 'direct',
      resolved_mode: 'direct',
      planner_routes: [
        {
          role: 'planning-agent',
          selected_model: 'codex',
          attempted_models: ['codex', 'gemini'],
          selected_model_metadata: {
            requested_model: 'codex',
            logical_model: 'codex',
            exact_model_id: 'openai-codex/gpt-5.4',
            provider: 'openai-codex',
            aliases: ['codex'],
          },
        },
      ],
    },
  };
}

export function buildDebatePlanningFixtureRequest(): PlanningRequest {
  return {
    request: 'Implement the planning workspace across the frontend dashboard and backend planning API.',
    project_summary: 'Cross-boundary planning work with contract, sequencing, and integration risk.',
    relevant_context: [
      'Frontend state and backend planning payloads must stay aligned.',
      'The flow has integration risk across the orchestrator boundary.',
    ],
    planning_mode: 'debate',
    constraints: [
      'Keep planning output limited to implementation tasks.',
      'Assigned agents must stay frontend-agent or backend-agent.',
      'Quality gates remain post-implementation roles.',
    ],
  };
}

export function buildDebatePlanningFixture(): PlanningResult {
  return {
    schema_version: '1.0.0',
    planning_mode: 'debate',
    epic: 'Implement the planning workspace across the frontend dashboard and backend planning API.',
    recommended_plan:
      'Establish the contract first, then layer UI work and integration handoff on top of it. Implement the contract, build the UI against it, then finish the integration handoff. Lock the contract, build the UI flow, and reserve a final task for integration validation.',
    tasks: [
      {
        id: 'task-plan-contract',
        title: 'Lock planning contract',
        description: 'Implement typed planning pipeline modules and the backend contract the UI depends on.',
        assigned_agent: 'backend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: [],
        acceptance_criteria: [
          'The planning contract is frozen before UI implementation starts.',
          'Module boundaries are explicit enough to prevent contract drift.',
          'The backend contract is typed and consumable by downstream tasks.',
          'The implementation can be validated before frontend work starts.',
          'The contract covers the backend payloads the UI and orchestrator rely on.',
          'Contract changes define the required integration touchpoints.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Contract changes must pass tests and review before downstream work starts.',
        },
      },
      {
        id: 'task-plan-ui',
        title: 'Build planning UI flow',
        description: 'Build the planning UI flow against the typed backend contract.',
        assigned_agent: 'frontend-agent',
        complexity: 'medium',
        risk: 'medium',
        depends_on: ['task-plan-contract'],
        acceptance_criteria: [
          'The UI implementation consumes the contract produced by task-plan-contract.',
          'UI state boundaries are explicit at the contract edge.',
          'The UI does not guess contract shape outside the backend task output.',
          'The frontend task stays independently testable.',
          'The UI task leaves the final integration handoff to a dedicated downstream task.',
          'UI state transitions align with the backend contract.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'UI changes must pass tests and review before integration handoff.',
        },
      },
      {
        id: 'task-plan-integration',
        title: 'Finalize planning integration handoff',
        description: 'Execute the final backend integration handoff and verify the runtime boundary conditions.',
        assigned_agent: 'backend-agent',
        complexity: 'high',
        risk: 'high',
        depends_on: ['task-plan-contract', 'task-plan-ui'],
        acceptance_criteria: [
          'Integration handoff starts only after task-plan-contract and task-plan-ui complete.',
          'The backend handoff preserves the contract locked earlier in the plan.',
          'Integration work preserves the agreed contract shape.',
          'The final backend handoff is testable with the completed UI flow.',
          'The integration task validates the runtime handoff after the upstream tasks complete.',
          'Boundary conditions and failure paths are covered in the implementation summary.',
        ],
        quality_gate: {
          test_required: true,
          review_required: true,
          gate_reason: 'Integration handoff work must pass tests and review.',
        },
      },
    ],
    notes_for_orchestrator: [
      'Architecture prefers sequencing that locks the contract before UI and integration work.',
      'Engineering wants the contract finished before frontend work to reduce rework.',
      'Integration analysis wants a dedicated handoff task after contract and UI work.',
      'Synthesized from architecture-planner, engineering-planner, and integration-planner.',
    ],
    risks: [
      'Contract drift will cause rework across the planning surface.',
      'Out-of-order implementation will increase refactor risk.',
      'Hidden runtime edge cases may appear at the UI/API boundary.',
    ],
    planning_trace: {
      requested_mode: 'debate',
      resolved_mode: 'debate',
      planner_routes: [
        {
          role: 'architecture-planner',
          selected_model: 'claude',
          attempted_models: ['claude', 'codex', 'gemini'],
          selected_model_metadata: {
            requested_model: 'claude',
            logical_model: 'claude',
            exact_model_id: 'anthropic/claude-opus-4-6',
            provider: 'anthropic',
            aliases: ['claude'],
          },
        },
        {
          role: 'engineering-planner',
          selected_model: 'codex',
          attempted_models: ['codex', 'claude', 'gemini'],
          selected_model_metadata: {
            requested_model: 'codex',
            logical_model: 'codex',
            exact_model_id: 'openai-codex/gpt-5.4',
            provider: 'openai-codex',
            aliases: ['codex'],
          },
        },
        {
          role: 'integration-planner',
          selected_model: 'gemini',
          attempted_models: ['gemini', 'codex', 'claude'],
          selected_model_metadata: {
            requested_model: 'gemini',
            logical_model: 'gemini',
            exact_model_id: 'google-gemini-cli/gemini-3.1-pro-preview',
            provider: 'google-gemini-cli',
            aliases: ['gemini'],
          },
        },
      ],
      debate: [
        {
          role: 'architecture-planner',
          summary: 'Freeze the planning contract before UI and integration work to reduce coupling.',
          recommended_plan:
            'Establish the contract first, then layer UI work and integration handoff on top of it.',
        },
        {
          role: 'engineering-planner',
          summary: 'Sequence implementation to minimize rework and keep changes independently testable.',
          recommended_plan:
            'Implement the contract, build the UI against it, then finish the integration handoff.',
        },
        {
          role: 'integration-planner',
          summary: 'Protect the UI/API handoff and runtime state transitions with explicit integration work.',
          recommended_plan:
            'Lock the contract, build the UI flow, and reserve a final task for integration validation.',
        },
      ],
    },
  };
}
