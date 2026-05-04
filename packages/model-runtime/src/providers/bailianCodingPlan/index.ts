import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { QwenAIStream } from '../../core/streams';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const LobeBailianCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, presence_penalty, temperature, thinking, top_p, messages, ...rest } = payload;

      const resolvedParams = resolveParameters(
        { presence_penalty, temperature, top_p },
        {
          normalizeTemperature: false,
          presencePenaltyRange: { max: 2, min: -2 },
          temperatureRange: { max: 2, min: 0 },
          topPRange: { max: 1, min: 0 },
        },
      );

      // Transform reasoning to reasoning_content for preserve_thinking to work
      // When preserve_thinking is enabled, API expects reasoning_content in assistant messages
      const processedMessages = messages?.map((message: any) => {
        if (message.role === 'assistant' && message.reasoning?.content) {
          const { reasoning, ...restMessage } = message;
          return {
            ...restMessage,
            reasoning_content: reasoning.content,
          };
        }
        return message;
      });

      return {
        ...rest,
        ...(thinking?.type === 'enabled' &&
          thinking?.budget_tokens !== 0 && {
            enable_thinking: true,
            preserve_thinking: true,
            thinking_budget: thinking?.budget_tokens || undefined,
          }),
        frequency_penalty: undefined,
        model,
        messages: processedMessages,
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
  // Coding Plan does NOT support fetching model list via API
  models: async () => {
    const { bailiancodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      bailiancodingplan.map((m: { id: string }) => ({ id: m.id })),
      'bailiancodingplan',
    );
  },
  provider: ModelProvider.BailianCodingPlan,
});
