export type RoleName =
  | 'planning-agent'
  | 'architecture-planner'
  | 'engineering-planner'
  | 'integration-planner'
  | 'frontend-agent'
  | 'backend-agent'
  | 'test-agent'
  | 'review-agent';

export interface ModelAvailability {
  availableModels: string[];
}

export interface ModelRouteDecision {
  role: RoleName;
  selectedModel: string;
  attemptedModels: string[];
}

export interface RoleModelPolicy {
  role: RoleName;
  preferredModels: string[];
}

export const DEFAULT_ROLE_MODEL_POLICIES: RoleModelPolicy[] = [
  {
    role: 'planning-agent',
    preferredModels: ['gpt-5.4', 'codex', 'gemini'],
  },
  {
    role: 'architecture-planner',
    preferredModels: ['claude', 'gpt-5.4', 'codex', 'gemini'],
  },
  {
    role: 'engineering-planner',
    preferredModels: ['codex', 'gpt-5.4', 'claude', 'gemini'],
  },
  {
    role: 'integration-planner',
    preferredModels: ['gemini', 'gpt-5.4', 'claude', 'codex'],
  },
  {
    role: 'frontend-agent',
    preferredModels: ['codex', 'gpt-5.4', 'gemini'],
  },
  {
    role: 'backend-agent',
    preferredModels: ['codex', 'gpt-5.4', 'claude', 'gemini'],
  },
  {
    role: 'test-agent',
    preferredModels: ['codex', 'gpt-5.4', 'gemini'],
  },
  {
    role: 'review-agent',
    preferredModels: ['claude', 'gpt-5.4', 'codex', 'gemini'],
  },
];

export class ModelRouter {
  constructor(private readonly policies: RoleModelPolicy[] = DEFAULT_ROLE_MODEL_POLICIES) {}

  route(role: RoleName, availability: ModelAvailability): ModelRouteDecision {
    const policy = this.getPolicy(role);

    for (const model of policy.preferredModels) {
      if (availability.availableModels.includes(model)) {
        return {
          role,
          selectedModel: model,
          attemptedModels: [...policy.preferredModels],
        };
      }
    }

    throw new Error(
      `No available model for role ${role}. Attempted: ${policy.preferredModels.join(', ')}`,
    );
  }

  routeNext(role: RoleName, currentModel: string, availability: ModelAvailability): ModelRouteDecision | null {
    const policy = this.getPolicy(role);
    const compatibleModels = policy.preferredModels.filter((model) =>
      availability.availableModels.includes(model),
    );

    const currentIndex = compatibleModels.indexOf(currentModel);
    if (currentIndex === -1) {
      return compatibleModels.length > 0
        ? {
            role,
            selectedModel: compatibleModels[0],
            attemptedModels: compatibleModels,
          }
        : null;
    }

    const nextModel = compatibleModels[currentIndex + 1];
    if (!nextModel) return null;

    return {
      role,
      selectedModel: nextModel,
      attemptedModels: compatibleModels.slice(currentIndex + 1),
    };
  }

  private getPolicy(role: RoleName): RoleModelPolicy {
    const policy = this.policies.find((item) => item.role === role);
    if (!policy) {
      throw new Error(`No model policy configured for role: ${role}`);
    }

    return policy;
  }
}
