import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface SokkanModelCard {
  availability?: string;
  available?: boolean;
  context_length?: number;
  id: string;
  max_output_tokens?: number;
  name?: string;
  pricing?: {
    cached?: string;
    completion?: string;
    prompt?: string;
  };
}

const toNumber = (value?: string) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const params = {
  baseURL: 'https://router.sokkan.ch/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_SOKKAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: SokkanModelCard[] = modelsPage.data || [];

    // `/v1/models` also lists models offered only with committed throughput
    // (`availability: "committed"`, 403 on a pay-per-token key) and best-effort
    // ones (`availability: "opportunistic"`); only on-demand models are usable
    // with a regular key.
    const modelList = rawList
      .filter((model) => model.available !== false && model.availability === 'on_demand')
      .map((model) => ({
        contextWindowTokens: model.context_length,
        displayName: model.name,
        id: model.id,
        maxOutput: model.max_output_tokens,
        pricing: {
          // prices are USD per 1M tokens
          cachedInput: toNumber(model.pricing?.cached),
          input: toNumber(model.pricing?.prompt),
          output: toNumber(model.pricing?.completion),
        },
      }));

    return processMultiProviderModelList(modelList, 'sokkan');
  },
  provider: ModelProvider.Sokkan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSokkanAI = createOpenAICompatibleRuntime(params);
