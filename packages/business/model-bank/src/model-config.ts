import type { AiFullModelCard, AiModelType } from 'model-bank';
import { loadModels as loadModelBankModels, ModelProvider } from 'model-bank';
import cometapiModels from 'model-bank/cometapi';

interface LobeHubModelConfig {
  models: AiFullModelCard[];
  planCardModels: string[];
  updatedAt?: string;
  version: number;
}

const parseConfiguredModels = (): string[] =>
  (process.env.ACENSUS_AI_MODELS || process.env.ACENSUS_AI_DEFAULT_MODEL || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const detectModelType = (id: string): AiModelType => {
  const model = id.toLowerCase();

  if (['embedding', 'embed', 'bge', 'm3e'].some((keyword) => model.includes(keyword))) {
    return 'embedding';
  }

  if (['video', 'wan-', 'sora', 'kling', 'veo'].some((keyword) => model.includes(keyword))) {
    return 'video';
  }

  if (
    ['dall-e', 'dalle', 'flux', 'imagen', 'midjourney', 'stable-diffusion', 'sdxl', '-image'].some(
      (keyword) => model.includes(keyword),
    )
  ) {
    return 'image';
  }

  return 'chat';
};

const buildFallbackModel = (id: string): AiFullModelCard => {
  const type = detectModelType(id);

  return {
    abilities:
      type === 'chat'
        ? {
            functionCall: true,
            vision: true,
          }
        : undefined,
    displayName: id,
    enabled: true,
    id,
    type,
  };
};

const getDefaultLobeHubModelConfig = (): LobeHubModelConfig => {
  const configuredModels = parseConfiguredModels();
  const configuredModelSet = new Set(configuredModels);
  const models = configuredModels.length
    ? configuredModels.map(
        (id) => cometapiModels.find((model) => model.id === id) ?? buildFallbackModel(id),
      )
    : cometapiModels;

  return {
    models: models.map((model) => ({ ...model, enabled: model.enabled ?? true })),
    planCardModels: (configuredModels.length
      ? configuredModels
      : cometapiModels.map((model) => model.id)
    )
      .filter((id) => configuredModelSet.size === 0 || configuredModelSet.has(id))
      .slice(0, 3),
    version: 1,
  };
};

const loadLobeHubModelConfig = async (): Promise<LobeHubModelConfig> =>
  getDefaultLobeHubModelConfig();

export const loadModels = async () =>
  loadModelBankModels({
    providerLoaders: {
      [ModelProvider.LobeHub]: loadLobeHubModels,
    },
  });

const loadLobeHubModels = async (): Promise<AiFullModelCard[]> =>
  (await loadLobeHubModelConfig()).models;

export const loadLobeHubPlanCardModels = async (): Promise<string[]> =>
  (await loadLobeHubModelConfig()).planCardModels;

export const isLobeHubModelAvailable = (
  _id: string,
  _expectedType: AiModelType,
  _options?: {
    getUserEmail?: () => Promise<string | null | undefined>;
    userEmail?: string | null;
  },
): boolean => {
  const configuredModels = parseConfiguredModels();

  if (configuredModels.length > 0) return configuredModels.includes(_id);

  return cometapiModels.some((model) => model.id === _id && model.type === _expectedType);
};
