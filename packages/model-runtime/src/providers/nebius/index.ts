import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface NebiusModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.studio.nebius.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, ...rest } = payload;

      return {
        ...rest,
        model,
        stream: true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NEBIUS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const base = (client as any).baseURL || 'https://api.studio.nebius.com/v1';
    const url = `${base.replace(/\/+$/, '')}/models?verbose=true`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${client.apiKey}`,
      },
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Nebius models: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as any;
    const rawList = body?.data ?? [];

    const standardList = rawList.map((m: any) => {
      const modality = m.architecture?.modality;
      let inferredType: string | undefined = undefined;

      if (typeof modality === 'string' && modality.includes('->')) {
        const parts = modality.split('->');
        const right = parts[1]?.trim().toLowerCase();
        if (right === 'image') {
          inferredType = 'image';
        }
        if (right === 'embedding') {
          inferredType = 'embedding';
        }
      }

      return {
        contextWindowTokens: m.context_length ?? undefined,
        description: m.description ?? '',
        displayName: m.name ?? m.id,
        functionCall: m.features?.includes('function-calling'),
        id: m.id,
        pricing: {
          input: m.pricing.prompt * 1_000_000,
          output: m.pricing.completion * 1_000_000,
        },
        reasoning: m.features?.includes('reasoning'),
        type: inferredType,
        vision: m.features?.includes('vision'),
      };
    });

    return processMultiProviderModelList(standardList, 'nebius');
  },
  provider: ModelProvider.Nebius,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNebiusAI = createOpenAICompatibleRuntime(params);
