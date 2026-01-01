import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createVolcengineImage } from './createImage';

export const LobeVolcengineAI = createOpenAICompatibleRuntime({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, reasoning_effort, ...rest } = payload;

      return {
        ...rest,
        model,
        ...(thinking?.type && { thinking: { type: thinking.type } }),
        ...(reasoning_effort && { reasoning_effort }),
      } as any;
    },
  },
  createImage: createVolcengineImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_VOLCENGINE_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Volcengine,
});
