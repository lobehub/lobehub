import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const LobeKimiCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.kimi.com/coding/v1',
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
    chatCompletion: () => process.env.DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  models: async () => {
    const { kimicodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      kimicodingplan.map((m: { id: string }) => ({ id: m.id })),
      'kimicodingplan',
    );
  },
  provider: ModelProvider.KimiCodingPlan,
});
