import { ModelProvider } from 'model-bank';

import type { ChatStreamPayload } from '@/types/index';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createVolcengineImage } from './createImage';
import { createVolcengineVideo } from './video/createVideo';
import { handleVolcengineVideoWebhook } from './video/handleCreateVideoWebhook';

export const LobeVolcengineAI = createOpenAICompatibleRuntime({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, thinking, reasoning_effort, ...rest } = payload;

      if (enabledSearch) {
        return {
          ...rest,
          apiMode: 'responses',
          enabledSearch,
          thinking,
          reasoning_effort,
        } as ChatStreamPayload;
      }

      return {
        ...rest,
        ...(thinking?.type && { thinking: { type: thinking.type } }),
        ...(reasoning_effort && { reasoning_effort }),
      } as any;
    },
  },
  createImage: createVolcengineImage,
  createVideo: createVolcengineVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_VOLCENGINE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_VOLCENGINE_RESPONSES === '1',
  },
  handleCreateVideoWebhook: handleVolcengineVideoWebhook,
  provider: ModelProvider.Volcengine,
  responses: {
    handlePayload: (payload) => {
      const { enabledSearch, tools, thinking, reasoning_effort, ...rest } = payload;

      const volcengineTools = enabledSearch
        ? [
            ...(tools || []),
            {
              function: {
                sources: ['douyin', 'moji', 'toutiao'], // Additional search sources (Douyin Baike, Moji Weather, Toutiao, etc.)
              },
              type: 'web_search',
            },
          ]
        : tools;

      return {
        ...rest,
        tools: volcengineTools,
        ...(thinking?.type && { thinking: { type: thinking.type } }),
        ...(reasoning_effort && { reasoning_effort }),
      } as any;
    },
  },
});
