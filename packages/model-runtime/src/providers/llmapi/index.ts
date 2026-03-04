import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeLlmApiAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.llmapi.ai/v1',
  constructorOptions: {
    defaultHeaders: { 'x-source': 'lobechat' },
  },
  chatCompletion: {
    handlePayload: (payload) => {
      const { messages, ...rest } = payload;
      return {
        ...rest,
        messages: messages?.map((msg) => {
          if (msg.content === null || msg.content === '') {
            const { content: _, ...msgRest } = msg;
            return msgRest;
          }
          return msg;
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LLMAPI_CHAT_COMPLETION === '1',
  },
  models: async () => {
    try {
      const response = await fetch('https://api.llmapi.ai/v1/models', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      const modelList: { id: string }[] = json?.data || [];

      return modelList.map((model) => ({
        enabled: true,
        functionCall: true,
        id: model.id,
      }));
    } catch (error) {
      console.warn(
        'Failed to fetch LLM API models. Please ensure the LLM API endpoint is accessible:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.LlmApi,
});
