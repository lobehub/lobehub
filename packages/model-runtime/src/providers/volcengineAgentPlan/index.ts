import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const LobeVolcengineAgentPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
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
    chatCompletion: () => process.env.DEBUG_VOLCENGINE_AGENT_PLAN_CHAT_COMPLETION === '1',
  },
  models: async () => {
    const { volcengineagentplan } = await import('model-bank');
    return processMultiProviderModelList(
      volcengineagentplan.map((m: { id: string }) => ({ id: m.id })),
      'volcengineagentplan',
    );
  },
  provider: ModelProvider.VolcengineAgentPlan,
});
