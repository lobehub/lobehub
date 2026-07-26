import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeMinimaxCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.minimaxi.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;

      return {
        ...rest,
        ...(thinking?.type === 'enabled' &&
          thinking?.budget_tokens !== 0 && {
            enable_thinking: true,
            thinking_budget: thinking?.budget_tokens || undefined,
          }),
        model,
        stream: true,
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { minimaxcodingplan } = await import('model-bank');
    const { resolveModelsDevModelList } = await import('../utils/modelsDev');
    return resolveModelsDevModelList({
      bankModels: minimaxcodingplan,
      client,
      modelsDevProvider: 'minimax-cn-coding-plan',
      providerId: 'minimaxcodingplan',
    });
  },
  provider: ModelProvider.MinimaxCodingPlan,
});
