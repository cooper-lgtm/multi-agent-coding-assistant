import type { ModelResolution } from '../schemas/models.js';

export interface OpenClawModelCatalogEntry {
  logical_model: string;
  exact_model_id: string;
  provider: string;
  aliases: string[];
}

export interface OpenClawResolvedModel extends ModelResolution {}

export const DEFAULT_OPENCLAW_MODEL_CATALOG: OpenClawModelCatalogEntry[] = [
  {
    logical_model: 'codex',
    exact_model_id: 'openai-codex/gpt-5.4',
    provider: 'openai-codex',
    aliases: ['codex'],
  },
  {
    logical_model: 'claude',
    exact_model_id: 'anthropic/claude-opus-4-6',
    provider: 'anthropic',
    aliases: ['claude'],
  },
  {
    logical_model: 'gemini',
    exact_model_id: 'google-gemini-cli/gemini-3.1-pro-preview',
    provider: 'google-gemini-cli',
    aliases: ['gemini'],
  },
];

export const DEFAULT_OPENCLAW_AVAILABLE_MODELS = DEFAULT_OPENCLAW_MODEL_CATALOG.map(
  (model) => model.exact_model_id,
);

export class OpenClawModelResolver {
  constructor(private readonly catalog: OpenClawModelCatalogEntry[] = DEFAULT_OPENCLAW_MODEL_CATALOG) {}

  resolve(model: string): OpenClawResolvedModel {
    const normalized = model.trim();
    const catalogEntry = this.findCatalogEntry(normalized);

    if (catalogEntry) {
      return {
        requested_model: normalized,
        logical_model: catalogEntry.logical_model,
        exact_model_id: catalogEntry.exact_model_id,
        provider: catalogEntry.provider,
        aliases: [...catalogEntry.aliases],
      };
    }

    return {
      requested_model: normalized,
      logical_model: normalized,
      exact_model_id: normalized,
      provider: this.deriveProvider(normalized),
      aliases: [normalized],
    };
  }

  resolveAvailableModels(models: string[]): OpenClawResolvedModel[] {
    return models.map((model) => this.resolve(model));
  }

  isAvailable(requestedModel: string, availableModels: string[]): boolean {
    return this.findAvailable(requestedModel, availableModels) !== null;
  }

  findAvailable(requestedModel: string, availableModels: string[]): OpenClawResolvedModel | null {
    const requested = this.resolve(requestedModel);

    for (const availableModel of availableModels) {
      const available = this.resolve(availableModel);
      if (!this.matches(requested, available)) continue;

      return {
        requested_model: requested.requested_model,
        logical_model: requested.logical_model,
        exact_model_id: available.exact_model_id,
        provider: available.provider,
        aliases: dedupe([...requested.aliases, ...available.aliases]),
      };
    }

    return null;
  }

  isSameModel(left: string, right: string): boolean {
    const leftResolved = this.resolve(left);
    const rightResolved = this.resolve(right);

    return this.matches(leftResolved, rightResolved);
  }

  isExactModelId(model: string): boolean {
    return this.catalog.some((entry) => entry.exact_model_id === model.trim());
  }

  private matches(left: OpenClawResolvedModel, right: OpenClawResolvedModel): boolean {
    return (
      left.exact_model_id === right.exact_model_id ||
      left.logical_model === right.logical_model ||
      left.aliases.some((alias) => right.aliases.includes(alias))
    );
  }

  private findCatalogEntry(model: string): OpenClawModelCatalogEntry | undefined {
    return this.catalog.find((entry) =>
      entry.exact_model_id === model ||
      entry.logical_model === model ||
      entry.aliases.includes(model),
    );
  }

  private deriveProvider(model: string): string {
    return model.includes('/') ? model.split('/')[0] : 'unknown';
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
