import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import type { NovitaModelCard } from './type';

const formatPrice = (price?: number) => {
  if (price === undefined || price === null) return undefined;
  // Convert Novita price to desired unit: e.g. 5700 -> 0.57
  if (typeof price !== 'number') return undefined;
  if (price === -1) return undefined;
  return Number((price / 10_000).toPrecision(5));
};

export const LobeNovitaAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.novita.ai/v3/openai',
  constructorOptions: {
    defaultHeaders: {
      'X-Novita-Source': 'lobechat',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NOVITA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: NovitaModelCard[] = modelsPage.data;

    const formattedModels = modelList.map((m) => {
      const mm = m as any;
      const features: string[] = Array.isArray(mm.features) ? mm.features : [];
      const inputModalities: string[] = Array.isArray(mm.input_modalities)
        ? mm.input_modalities
        : [];

      return {
        contextWindowTokens: mm.context_size ?? mm.max_output_tokens ?? undefined,
        created: mm.created,
        description: mm.description ?? '',
        displayName: mm.display_name ?? mm.title ?? mm.id,
        functionCall: features.includes('function-calling') || false,
        id: mm.id,
        maxOutput: typeof mm.max_output_tokens === 'number' ? mm.max_output_tokens : undefined,
        pricing: {
          input: formatPrice(mm.input_token_price_per_m),
          output: formatPrice(mm.output_token_price_per_m),
        },
        reasoning: features.includes('reasoning') || false,
        type: mm.model_type ?? undefined,
        vision: inputModalities.includes('image') || features.includes('vision') || false,
      } as any;
    });

    return await processMultiProviderModelList(formattedModels, 'novita');
  },
  provider: ModelProvider.Novita,
});
