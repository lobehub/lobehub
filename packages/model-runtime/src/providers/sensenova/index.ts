import type { ChatModelCard } from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface SenseNovaModelCard {
  context_length: number;
  created: number;
  description: string;
  id: string;
  input_modalities: string[];
  max_output_length: number;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
    input_cache_read: string;
  };
  supported_features: string[];
}

export const params = {
  baseURL: 'https://token.sensenova.cn/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, presence_penalty, temperature, top_p, ...rest } = payload;

      return {
        ...rest,
        frequency_penalty:
          frequency_penalty !== undefined && frequency_penalty > 0 && frequency_penalty <= 2
            ? frequency_penalty
            : undefined,
        presence_penalty:
          presence_penalty !== undefined && presence_penalty > 0 && presence_penalty <= 2
            ? presence_penalty
            : undefined,
        temperature:
          temperature !== undefined && temperature > 0 && temperature <= 2
            ? temperature
            : undefined,
        top_p: top_p !== undefined && top_p > 0 && top_p < 1 ? top_p : undefined,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_SENSENOVA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: SenseNovaModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: model.context_length ?? knownModel?.contextWindowTokens ?? undefined,
          displayName: model.name ?? knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall:
            model.supported_features?.includes('tools') ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          maxOutput: model.max_output_length ?? knownModel?.maxOutput ?? undefined,
          pricing: {
            units: [
              {
                name: 'textInput',
                rate: model.pricing.prompt ? parseFloat(model.pricing.prompt) : 0,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textInput_cacheRead',
                rate: model.pricing.input_cache_read
                  ? parseFloat(model.pricing.input_cache_read)
                  : 0,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textOutput',
                rate: model.pricing.completion ? parseFloat(model.pricing.completion) : 0,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
            ],
          },
          releasedAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
          reasoning:
            model.supported_features?.includes('reasoning') ||
            knownModel?.abilities?.reasoning ||
            false,
          structuredOutput:
            model.supported_features?.includes('json_mode') ||
            knownModel?.abilities?.structuredOutput ||
            false,
          vision:
            model.input_modalities?.includes('image') || knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.SenseNova,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSenseNovaAI = createOpenAICompatibleRuntime(params);
