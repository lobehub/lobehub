import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';

export interface XAIModelCard {
  id: string;
}

const isXAIReasoningModel = (model: string) => {
  if (model.includes('non-reasoning')) return false;

  return (
    model === 'grok-3-mini' ||
    model === 'grok-4' ||
    model === 'grok-code-fast-1' ||
    model.includes('multi-agent') ||
    model.includes('reasoning')
  );
};

const pruneUnsupportedReasoningParameters = (payload: ChatStreamPayload) => {
  if (!isXAIReasoningModel(payload.model)) return payload;

  return {
    ...payload,
    // xAI rejects penalties on reasoning models such as grok-4.
    frequency_penalty: undefined,
    presence_penalty: undefined,
    stop: undefined,
  } as ChatStreamPayload;
};

export const LobeXAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => pruneUnsupportedReasoningParameters(payload) as any,
    useResponse: true,
  },
  createImage: createXAIImage,
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
