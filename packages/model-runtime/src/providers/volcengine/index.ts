import { ModelProvider } from 'model-bank';

import type { ChatStreamPayload } from '@/types/index';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createVolcengineImage } from './createImage';
import { createVolcengineVideo } from './video/createVideo';
import { handleVolcengineVideoWebhook } from './video/handleCreateVideoWebhook';

const resolveVolcengineReasoningParams = (
  model: string,
  thinking: any,
  reasoning_effort: any,
  isResponses = false,
) => {
  let targetThinking = thinking;
  let targetReasoningEffort = reasoning_effort;

  if (model?.includes('deepseek-v4')) {
    if (thinking?.type === 'disabled') {
      targetThinking = { type: 'disabled' };
      targetReasoningEffort = 'minimal';
    } else if (thinking?.type === 'enabled' || reasoning_effort) {
      targetThinking = { type: 'enabled' };
      let effort = reasoning_effort || 'high';
      if (isResponses && effort === 'max') {
        effort = 'high';
      }
      targetReasoningEffort = effort;
    }
  }

  return {
    thinking: targetThinking,
    reasoning_effort: targetReasoningEffort,
  };
};

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
        } as ChatStreamPayload;
      }

      const params = resolveVolcengineReasoningParams(
        payload.model,
        thinking,
        reasoning_effort,
        false,
      );

      return {
        ...rest,
        ...(params.thinking?.type && { thinking: { type: params.thinking.type } }),
        ...(params.reasoning_effort && { reasoning_effort: params.reasoning_effort }),
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
      const params = resolveVolcengineReasoningParams(
        payload.model,
        thinking,
        reasoning_effort,
        true,
      );

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
        ...(params.thinking?.type && { thinking: { type: params.thinking.type } }),
        ...(params.reasoning_effort && { reasoning_effort: params.reasoning_effort }),
      } as any;
    },
  },
});
