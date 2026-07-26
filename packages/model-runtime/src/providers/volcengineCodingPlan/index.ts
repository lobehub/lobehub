import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeVolcengineCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
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
    chatCompletion: () => process.env.DEBUG_VOLCENGINE_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { volcenginecodingplan } = await import('model-bank');
    const { processMultiProviderModelList } = await import('../../utils/modelParse');

    // No models.dev coding-plan provider for Volcengine — try live API, then bank.
    try {
      const modelsPage = await (client as any)?.models?.list?.();
      const apiModels = modelsPage?.data || [];
      if (apiModels.length > 0) {
        const bankById = new Map(volcenginecodingplan.map((m) => [m.id, m]));
        return processMultiProviderModelList(
          apiModels.map((m: { id: string }) => ({
            id: m.id,
            settings: bankById.get(m.id)?.settings,
          })),
          'volcenginecodingplan',
        );
      }
    } catch {
      // fall through
    }

    return processMultiProviderModelList(
      volcenginecodingplan.map((m) => ({
        id: m.id,
        settings: m.settings,
      })),
      'volcenginecodingplan',
    );
  },
  provider: ModelProvider.VolcengineCodingPlan,
});
