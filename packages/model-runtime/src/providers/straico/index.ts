import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { StraicoChatModel, StraicoModelsResponse } from './type';

const formatPrice = (pricing?: { coins?: number; words?: number }) => {
  if (!pricing || typeof pricing.coins !== 'number' || typeof pricing.words !== 'number') {
    return undefined;
  }
  // Convert coins per N words to cost per 1M tokens
  // Assuming 1 word ≈ 1.33 tokens (standard approximation)
  // Note: 40000 coin = $20 (coins are not dollars)
  const tokensPerWord = 1.33;
  const tokensPerUnit = pricing.words * tokensPerWord;
  const coinsToUSD = pricing.coins / 2000; // Convert coins (cents) to USD
  const costPerMillionTokens = (coinsToUSD / tokensPerUnit) * 1_000_000;
  return Number(costPerMillionTokens.toPrecision(5));
};

const cleanModelName = (name: string): string => {
  // Remove provider prefixes like "xAI: ", "OpenAI: ", etc.
  return name.replace(/^[^:]+:\s*/, '');
};

export const LobeStraicoAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.straico.com/v0',
  chatCompletion: {
    handlePayload: (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
      const { model, ...rest } = payload;

      return {
        ...rest,
        model,
        stream: false,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_STRAICO_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const url = 'https://api.straico.com/v1/models';
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
        },
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: StraicoModelsResponse = await response.json();
      const chatModels: StraicoChatModel[] = json?.data?.chat || []; // 另有 audio, image 模型待适配

      // Transform Straico models to standardized format
      const formattedModels = chatModels.map((model) => {
        const inputPrice = formatPrice(model.pricing);
        const outputPrice = inputPrice; // Straico uses same price for input/output

        return {
          contextWindowTokens: model.word_limit
            ? Math.floor(model.word_limit * 1.33) // Convert words to tokens
            : undefined,
          description: model.metadata?.pros?.join('; ') || '',
          displayName: cleanModelName(model.name),
          enabled: model.enabled ?? false,
          functionCall: false,
          id: model.model,
          maxOutput: model.max_output,
          pricing: inputPrice
            ? {
                input: inputPrice,
                output: outputPrice,
              }
            : undefined,
          reasoning: model.metadata?.applications?.includes('Reasoning') ?? false,
          vision: model.metadata?.features?.includes('Image input') ?? false,
        };
      });

      return await processMultiProviderModelList(formattedModels, 'straico');
    } catch (error) {
      console.warn(
        'Failed to fetch Straico models. Please ensure your Straico API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.Straico,
});
