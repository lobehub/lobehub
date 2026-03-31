import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

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
  models: async () => {
    const { minimaxcodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      minimaxcodingplan.map((m: { id: string }) => ({ id: m.id })),
      'minimaxcodingplan',
    );
  },
  provider: ModelProvider.MinimaxCodingPlan,
});
