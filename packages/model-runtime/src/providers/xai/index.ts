import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';
import { createXAIVideo } from './createVideo';

export interface XAIModelCard {
  id: string;
}

export const LobeXAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    useResponse: true,
  },
  createImage: createXAIImage,
  createVideo: createXAIVideo,
  handlePollVideoStatus: async (inferenceId, options) => {
    const { pollXAIVideoStatus } = await import('./createVideo');
    return pollXAIVideoStatus(inferenceId, {
      apiKey: options.apiKey,
      baseURL: options.baseURL || '',
    });
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_XAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_XAI_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: XAIModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.xai, 'xai');
  },
  provider: ModelProvider.XAI,
  responses: {
    handlePayload: (payload) => {
      const { enabledSearch, tools, ...rest } = payload;

      const xaiTools = enabledSearch
        ? [...(tools || []), { type: 'web_search' }, { type: 'x_search' }]
        : tools;

      return {
        ...rest,
        frequency_penalty: undefined, // NOT SUPPORTED in Responses API
        presence_penalty: undefined, // NOT SUPPORTED in Responses API
        tools: xaiTools,
        include: ['reasoning.encrypted_content'],
      } as any;
    },
  },
});
