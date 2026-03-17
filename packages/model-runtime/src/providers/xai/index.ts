import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';

export interface XAIModelCard {
  id: string;
}

const xaiReasoningModels = new Set(
  LOBE_DEFAULT_MODEL_LIST.filter(
    (model) =>
      model.providerId === ModelProvider.XAI &&
      model.type === 'chat' &&
      !!model.abilities?.reasoning,
  ).map((model) => model.id),
);

const isXAIReasoningModel = (model: string) => xaiReasoningModels.has(model);

const pruneUnsupportedReasoningParameters = (payload: ChatStreamPayload) => {
  if (!isXAIReasoningModel(payload.model)) return payload;

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
