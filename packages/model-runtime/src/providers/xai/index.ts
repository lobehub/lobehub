import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';

export interface XAIModelCard {
  id: string;
}

export const GrokReasoningModels = new Set(['grok-3-mini', 'grok-4', 'grok-code']);

export const isGrokReasoningModel = (model: string) =>
  Array.from(GrokReasoningModels).some((id) => model.includes(id));

export const LobeXAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    useResponse: true,
  },
  createImage: createXAIImage,
  debug: {
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
      const { enabledSearch, frequency_penalty, model, presence_penalty, tools, ...rest } = payload;

      const xaiTools = enabledSearch
        ? [...(tools || []), { type: 'web_search' }, { type: 'x_search' }]
        : tools;

      return {
        ...rest,
        frequency_penalty: isGrokReasoningModel(model) ? undefined : frequency_penalty,
        model,
        presence_penalty: isGrokReasoningModel(model) ? undefined : presence_penalty,
        stream: payload.stream ?? true,
        tools: xaiTools,
        include: ['reasoning.encrypted_content'],
      } as any;
    },
  },
});
