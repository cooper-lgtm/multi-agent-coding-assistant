import type { DebatePlannerRoleName, PlanningTask } from '../schemas/planning.js';
import type {
  DebateAnalysis,
  DebateAnalyzer,
  DebateAnalyzerInput,
  DirectPlanner,
  DirectPlanningInput,
  PlanningDraft,
} from './contracts.js';

const FRONTEND_PATTERNS = [/\bfrontend\b/, /\bui\b/, /\bpage\b/, /\bdashboard\b/, /\bpanel\b/, /\bview\b/];
const BACKEND_PATTERNS = [/\bbackend\b/, /\bapi\b/, /\bendpoint\b/, /\bcontract\b/, /\bschema\b/];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function buildRequestText(input: { request: string; project_summary: string; relevant_context: string[] }): string {
  return [input.request, input.project_summary, ...input.relevant_context].join(' ').toLowerCase();
}

function buildQualityGate(gateReason: string) {
  return {
    test_required: true,
    review_required: true,
    gate_reason: gateReason,
  };
}

function buildContractTask(description: string, acceptance_criteria: string[]): PlanningTask {
  return {
    id: 'task-plan-contract',
    title: 'Lock planning contract',
    description,
    assigned_agent: 'backend-agent',
    complexity: 'medium',
    risk: 'medium',
    depends_on: [],
    acceptance_criteria,
    quality_gate: buildQualityGate('Contract changes must pass tests and review before downstream work starts.'),
  };
}

function buildUiTask(description: string, acceptance_criteria: string[]): PlanningTask {
  return {
    id: 'task-plan-ui',
    title: 'Build planning UI flow',
    description,
    assigned_agent: 'frontend-agent',
    complexity: 'medium',
    risk: 'medium',
    depends_on: ['task-plan-contract'],
    acceptance_criteria,
    quality_gate: buildQualityGate('UI changes must pass tests and review before integration handoff.'),
  };
}

function buildIntegrationTask(description: string, acceptance_criteria: string[]): PlanningTask {
  return {
    id: 'task-plan-integration',
    title: 'Finalize planning integration handoff',
    description,
    assigned_agent: 'backend-agent',
    complexity: 'high',
    risk: 'high',
    depends_on: ['task-plan-contract', 'task-plan-ui'],
    acceptance_criteria,
    quality_gate: buildQualityGate('Integration handoff work must pass tests and review.'),
  };
}

export class MockDirectPlanner implements DirectPlanner {
  async plan(input: DirectPlanningInput): Promise<PlanningDraft> {
    const text = buildRequestText(input.request);
    const needsFrontend = matchesAny(text, FRONTEND_PATTERNS);

    if (needsFrontend) {
      return {
        epic: input.request.request.trim(),
        recommended_plan: 'Lock the plan contract first, then build the plan UI.',
        tasks: [
          buildContractTask(
            'Define the backend planning contract that downstream UI work depends on.',
            [
              'The planning contract shape is explicit and stable for downstream consumers.',
              'Implementation notes identify the backend contract surface.',
            ],
          ),
          buildUiTask(
            'Build the frontend planning UI against the locked backend contract.',
            [
              'The UI reads from the contract produced by task-plan-contract.',
              'Implementation notes identify the frontend change surface.',
            ],
          ),
        ],
        notes_for_orchestrator: [
          'Direct planning stayed on implementation tasks only.',
        ],
        risks: ['UI delivery depends on the contract staying stable after the backend task.'],
      };
    }

    return {
      epic: input.request.request.trim(),
      recommended_plan: 'Implement the scoped backend planning change in one task.',
      tasks: [
        {
          id: 'task-plan-backend',
          title: 'Implement backend planning change',
          description: 'Apply the requested backend-only planning change.',
          assigned_agent: 'backend-agent',
          complexity: 'low',
          risk: 'low',
          depends_on: [],
          acceptance_criteria: [
            'The backend planning change is implemented in one scoped task.',
            'Implementation notes identify the backend files that changed.',
          ],
          quality_gate: buildQualityGate('Backend-only changes still require tests and review.'),
        },
      ],
      notes_for_orchestrator: ['Direct planning stayed on implementation tasks only.'],
    };
  }
}

function buildArchitectureAnalysis(input: DebateAnalyzerInput): DebateAnalysis {
  return {
    role: input.role,
    planner_route: input.planner_route,
    epic: input.request.request.trim(),
    summary: 'Freeze the planning contract before UI and integration work to reduce coupling.',
    recommended_plan:
      'Establish the contract first, then layer UI work and integration handoff on top of it.',
    tasks: [
      buildContractTask(
        'Define the planning contract and module boundaries that all downstream work depends on.',
        [
          'The planning contract is frozen before UI implementation starts.',
          'Module boundaries are explicit enough to prevent contract drift.',
        ],
      ),
      buildUiTask(
        'Build the UI flow only after the planning contract is stable.',
        [
          'The UI implementation consumes the contract produced by task-plan-contract.',
          'UI state boundaries are explicit at the contract edge.',
        ],
      ),
      buildIntegrationTask(
        'Finalize the backend integration handoff after the contract and UI are aligned.',
        [
          'Integration handoff starts only after task-plan-contract and task-plan-ui complete.',
          'The backend handoff preserves the contract locked earlier in the plan.',
        ],
      ),
    ],
    notes_for_orchestrator: [
      'Architecture prefers sequencing that locks the contract before UI and integration work.',
    ],
    risks: ['Contract drift will cause rework across the planning surface.'],
  };
}

function buildEngineeringAnalysis(input: DebateAnalyzerInput): DebateAnalysis {
  return {
    role: input.role,
    planner_route: input.planner_route,
    epic: input.request.request.trim(),
    summary: 'Sequence implementation to minimize rework and keep changes independently testable.',
    recommended_plan:
      'Implement the contract, build the UI against it, then finish the integration handoff.',
    tasks: [
      buildContractTask(
        'Implement typed planning pipeline modules and the backend contract the UI depends on.',
        [
          'The backend contract is typed and consumable by downstream tasks.',
          'The implementation can be validated before frontend work starts.',
        ],
      ),
      buildUiTask(
        'Build the planning UI flow against the typed backend contract.',
        [
          'The UI does not guess contract shape outside the backend task output.',
          'The frontend task stays independently testable.',
        ],
      ),
      buildIntegrationTask(
        'Complete the backend integration path once the contract and UI tasks are in place.',
        [
          'Integration work preserves the agreed contract shape.',
          'The final backend handoff is testable with the completed UI flow.',
        ],
      ),
    ],
    notes_for_orchestrator: [
      'Engineering wants the contract finished before frontend work to reduce rework.',
    ],
    risks: ['Out-of-order implementation will increase refactor risk.'],
  };
}

function buildIntegrationAnalysis(input: DebateAnalyzerInput): DebateAnalysis {
  return {
    role: input.role,
    planner_route: input.planner_route,
    epic: input.request.request.trim(),
    summary: 'Protect the UI/API handoff and runtime state transitions with explicit integration work.',
    recommended_plan:
      'Lock the contract, build the UI flow, and reserve a final task for integration validation.',
    tasks: [
      buildContractTask(
        'Define the backend contract with the integration handoff in mind.',
        [
          'The contract covers the backend payloads the UI and orchestrator rely on.',
          'Contract changes define the required integration touchpoints.',
        ],
      ),
      buildUiTask(
        'Build the UI flow so it is ready for the backend integration handoff.',
        [
          'The UI task leaves the final integration handoff to a dedicated downstream task.',
          'UI state transitions align with the backend contract.',
        ],
      ),
      buildIntegrationTask(
        'Execute the final backend integration handoff and verify the runtime boundary conditions.',
        [
          'The integration task validates the runtime handoff after the upstream tasks complete.',
          'Boundary conditions and failure paths are covered in the implementation summary.',
        ],
      ),
    ],
    notes_for_orchestrator: [
      'Integration analysis wants a dedicated handoff task after contract and UI work.',
    ],
    risks: ['Hidden runtime edge cases may appear at the UI/API boundary.'],
  };
}

export class MockDebateAnalyzer implements DebateAnalyzer {
  constructor(private readonly role: DebatePlannerRoleName) {}

  async analyze(input: DebateAnalyzerInput): Promise<DebateAnalysis> {
    switch (this.role) {
      case 'architecture-planner':
        return buildArchitectureAnalysis(input);
      case 'engineering-planner':
        return buildEngineeringAnalysis(input);
      case 'integration-planner':
        return buildIntegrationAnalysis(input);
    }
  }
}
