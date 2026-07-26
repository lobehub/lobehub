import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { QwenAIStream } from '../../core/streams';

export const LobeBailianCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, presence_penalty, temperature, thinking, top_p, ...rest } = payload;

      const resolvedParams = resolveParameters(
        { presence_penalty, temperature, top_p },
        {
          normalizeTemperature: false,
          presencePenaltyRange: { max: 2, min: -2 },
          temperatureRange: { max: 2, min: 0 },
          topPRange: { max: 1, min: 0 },
        },
      );

      return {
        ...rest,
        ...(thinking?.type === 'enabled' &&
          thinking?.budget_tokens !== 0 && {
            enable_thinking: true,
            thinking_budget: thinking?.budget_tokens || undefined,
          }),
        frequency_penalty: undefined,
        model,
        presence_penalty: resolvedParams.presence_penalty,
        stream: true,
        temperature: resolvedParams.temperature,
        top_p: resolvedParams.top_p,
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
    handleStream: QwenAIStream,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_BAILIAN_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  // Prefer the official API list and enrich it with models.dev metadata.
  models: async ({ client }) => {
    const { bailiancodingplan } = await import('model-bank');
    const { resolveModelsDevModelList } = await import('../utils/modelsDev');
    return resolveModelsDevModelList({
      bankModels: bailiancodingplan,
      client,
      modelsDevProvider: 'alibaba-coding-plan-cn',
      providerId: 'bailiancodingplan',
    });
  },
  provider: ModelProvider.BailianCodingPlan,
});
