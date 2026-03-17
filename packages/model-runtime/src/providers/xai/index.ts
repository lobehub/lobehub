import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';
import { createXAIVideo } from './createVideo';

export interface XAIModelCard {
  id: string;
}

// Only these legacy non-reasoning models support presencePenalty/frequencyPenalty/stop.
// All newer models reject these params, so default to stripping.
const xaiPenaltySupportedModels = new Set([
  'grok-3',
  'grok-4-fast-non-reasoning',
  'grok-4-1-fast-non-reasoning',
]);

const pruneUnsupportedReasoningParameters = (payload: ChatStreamPayload) => {
  if (xaiPenaltySupportedModels.has(payload.model)) return payload;

  return {
    ...payload,
    // xAI reasoning models reject these parameters:
    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    frequency_penalty: undefined,
    presence_penalty: undefined,
    stop: undefined,
  } as ChatStreamPayload;
};

export const LobeXAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    handlePayload: (payload) =>
      ({
        ...pruneUnsupportedReasoningParameters(payload),
        stream: payload.stream ?? true,
      }) as any,
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
      const { enabledSearch, tools, ...rest } = pruneUnsupportedReasoningParameters(payload);

      const xaiTools = enabledSearch
        ? [...(tools || []), { type: 'web_search' }, { type: 'x_search' }]
        : tools;

      return {
        ...rest,
        tools: xaiTools,
        include: ['reasoning.encrypted_content'],
      } as any;
    },
  },
});
