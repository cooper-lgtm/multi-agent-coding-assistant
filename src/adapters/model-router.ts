import type { ModelResolution } from '../schemas/models.js';
import { OpenClawModelResolver } from './openclaw-model-resolver.js';

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
  selectedModelExactId: string | null;
  selectedModelProvider: string | null;
  selectedModelMetadata?: ModelResolution;
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
  private readonly resolver: OpenClawModelResolver;

  constructor(
    private readonly policies: RoleModelPolicy[] = DEFAULT_ROLE_MODEL_POLICIES,
    resolver = new OpenClawModelResolver(),
  ) {
    this.resolver = resolver;
  }

  route(role: RoleName, availability: ModelAvailability): ModelRouteDecision {
    const policy = this.getPolicy(role);

    for (const model of policy.preferredModels) {
      const resolvedModel = this.resolver.findAvailable(model, availability.availableModels);
      if (resolvedModel) {
        return {
          role,
          selectedModel: model,
          attemptedModels: [...policy.preferredModels],
          selectedModelExactId: resolvedModel.exact_model_id,
          selectedModelProvider: resolvedModel.provider,
          selectedModelMetadata: resolvedModel,
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
      this.resolver.isAvailable(model, availability.availableModels),
    );

    const currentIndex =
      compatibleModels.indexOf(currentModel) >= 0
        ? compatibleModels.indexOf(currentModel)
        : compatibleModels.findIndex((model) => this.resolver.isSameModel(model, currentModel));
    if (currentIndex === -1) {
      const fallbackModel = compatibleModels[0];
      if (!fallbackModel) return null;

      const resolvedFallback = this.resolver.findAvailable(fallbackModel, availability.availableModels)
        ?? this.resolver.resolve(fallbackModel);

      return compatibleModels.length > 0
        ? {
            role,
            selectedModel: fallbackModel,
            attemptedModels: compatibleModels,
            selectedModelExactId: resolvedFallback.exact_model_id,
            selectedModelProvider: resolvedFallback.provider,
            selectedModelMetadata: resolvedFallback,
          }
        : null;
    }

    const nextModel = compatibleModels[currentIndex + 1];
    if (!nextModel) return null;

    const resolvedNextModel = this.resolver.findAvailable(nextModel, availability.availableModels)
      ?? this.resolver.resolve(nextModel);

    return {
      role,
      selectedModel: nextModel,
      attemptedModels: compatibleModels.slice(currentIndex + 1),
      selectedModelExactId: resolvedNextModel.exact_model_id,
      selectedModelProvider: resolvedNextModel.provider,
      selectedModelMetadata: resolvedNextModel,
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
