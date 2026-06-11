import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeAntGroupAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.tbox.cn/api/llm/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, reasoning_effort, ...rest } = payload;

      return {
        ...rest,
        ...(reasoning_effort && { reasoning: { effort: reasoning_effort } }),
        ...(enabledSearch && {
          enable_search: true,
          // search_options: { forced_search: true },
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ANTGROUP_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.AntGroup,
});
