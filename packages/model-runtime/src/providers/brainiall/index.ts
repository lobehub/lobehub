import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://apim-ai-apis.azure-api.net/v1',
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
    chatCompletion: () => process.env.DEBUG_BRAINIALL_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const base = (client as any).baseURL || 'https://apim-ai-apis.azure-api.net/v1';
    const url = `${base.replace(/\/+$/, '')}/models`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${client.apiKey}`,
      },
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Brainiall models: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as any;
    const rawList = body?.data ?? [];

    const standardList = rawList.map((m: any) => ({
      contextWindowTokens: m.context_window ?? undefined,
      description: m.description ?? '',
      displayName: m.name ?? m.id,
      functionCall: m.capabilities?.function_calling,
      id: m.id,
      reasoning: m.capabilities?.reasoning,
      vision: m.capabilities?.vision,
    }));

    return processMultiProviderModelList(standardList, 'brainiall');
  },
  provider: ModelProvider.Brainiall,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeBrainiallAI = createOpenAICompatibleRuntime(params);
