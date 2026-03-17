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

export interface ModelRouteOptions {
  preferredModels?: string[];
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
    preferredModels: ['codex', 'gemini'],
  },
  {
    role: 'architecture-planner',
    preferredModels: ['claude', 'codex', 'gemini'],
  },
  {
    role: 'engineering-planner',
    preferredModels: ['codex', 'claude', 'gemini'],
  },
  {
    role: 'integration-planner',
    preferredModels: ['gemini', 'codex', 'claude'],
  },
  {
    role: 'frontend-agent',
    preferredModels: ['codex', 'gemini'],
  },
  {
    role: 'backend-agent',
    preferredModels: ['codex', 'claude', 'gemini'],
  },
  {
    role: 'test-agent',
    preferredModels: ['codex', 'gemini'],
  },
  {
    role: 'review-agent',
    preferredModels: ['claude', 'codex', 'gemini'],
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

  route(role: RoleName, availability: ModelAvailability, options: ModelRouteOptions = {}): ModelRouteDecision {
    const preferredModels = this.getPreferredModels(role, options.preferredModels);

    for (const model of preferredModels) {
      const resolvedModel = this.resolver.findAvailable(model, availability.availableModels);
      if (resolvedModel) {
        return {
          role,
          selectedModel: model,
          attemptedModels: [...preferredModels],
          selectedModelExactId: resolvedModel.exact_model_id,
          selectedModelProvider: resolvedModel.provider,
          selectedModelMetadata: resolvedModel,
        };
      }
    }

    throw new Error(
      `No available model for role ${role}. Attempted: ${preferredModels.join(', ')}`,
    );
  }

  routeNext(
    role: RoleName,
    currentModel: string,
    availability: ModelAvailability,
    options: ModelRouteOptions = {},
  ): ModelRouteDecision | null {
    const preferredModels = this.getPreferredModels(role, options.preferredModels);
    const compatibleRoutes = preferredModels.flatMap((model) => {
      const resolved = this.resolver.findAvailable(model, availability.availableModels);
      return resolved ? [{ model, resolved }] : [];
    });

    const currentResolved = this.resolver.resolve(currentModel);
    const currentIndex = compatibleRoutes.findIndex(({ model, resolved }) =>
      model === currentModel ||
      this.resolver.isSameModel(model, currentModel) ||
      resolved.exact_model_id === currentResolved.exact_model_id,
    );

    if (currentIndex === -1) {
      const fallbackRoute = compatibleRoutes[0];
      if (!fallbackRoute) return null;

      return {
        role,
        selectedModel: fallbackRoute.model,
        attemptedModels: compatibleRoutes.map(({ model }) => model),
        selectedModelExactId: fallbackRoute.resolved.exact_model_id,
        selectedModelProvider: fallbackRoute.resolved.provider,
        selectedModelMetadata: fallbackRoute.resolved,
      };
    }

    for (const nextRoute of compatibleRoutes.slice(currentIndex + 1)) {
      if (nextRoute.resolved.exact_model_id === currentResolved.exact_model_id) {
        continue;
      }

      return {
        role,
        selectedModel: nextRoute.model,
        attemptedModels: compatibleRoutes.slice(currentIndex + 1).map(({ model }) => model),
        selectedModelExactId: nextRoute.resolved.exact_model_id,
        selectedModelProvider: nextRoute.resolved.provider,
        selectedModelMetadata: nextRoute.resolved,
      };
    }

    return null;
  }

  private getPolicy(role: RoleName): RoleModelPolicy {
    const policy = this.policies.find((item) => item.role === role);
    if (!policy) {
      throw new Error(`No model policy configured for role: ${role}`);
    }

    return policy;
  }

  private getPreferredModels(role: RoleName, preferredModels?: string[]): string[] {
    if (preferredModels && preferredModels.length > 0) {
      return [...preferredModels];
    }

    return [...this.getPolicy(role).preferredModels];
  }
}
