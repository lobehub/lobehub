import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatResponseFormat, ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createXAIImage } from './createImage';
import { createXAIVideo } from './createVideo';

export interface XAIModelCard {
  id: string;
}

interface XAIChatStreamPayload extends ChatStreamPayload {
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
}

const supportsChatCompletionPenaltyParameters = (model: string) => model.startsWith('grok-3');

const stripUnsupportedPenaltyParameters = (payload: ChatStreamPayload) => {
  const {
    frequencyPenalty: _frequencyPenalty,
    presencePenalty: _presencePenalty,
    ...rest
  } = payload as XAIChatStreamPayload;

  return {
    ...rest,
    frequency_penalty: undefined,
    presence_penalty: undefined,
    stop: undefined,
  } as ChatStreamPayload;
};

const pruneUnsupportedChatCompletionParameters = (payload: ChatStreamPayload) => {
  if (supportsChatCompletionPenaltyParameters(payload.model)) return payload;

  return stripUnsupportedPenaltyParameters(payload);
};

/**
 * xAI Responses API accepts structured output constraints under `text.format`,
 * while callers still send OpenAI Chat Completions compatible `response_format`.
 */
const mapResponseFormatToResponsesText = (
  responseFormat?: ChatResponseFormat,
  text?: ChatStreamPayload['text'],
) => {
  if (!responseFormat) return text;

  if (responseFormat.type === 'json_schema') {
    return {
      ...text,
      format: { type: 'json_schema', ...responseFormat.json_schema },
    };
  }

  return {
    ...text,
    format: { type: responseFormat.type },
  };
};

export const LobeXAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    handlePayload: (payload) =>
      ({
        ...pruneUnsupportedChatCompletionParameters(payload),
        apiMode: 'responses',
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
      const { enabledSearch, response_format, text, tools, ...rest } =
        stripUnsupportedPenaltyParameters(payload);

      const xaiTools = enabledSearch
        ? [...(tools || []), { type: 'web_search' }, { type: 'x_search' }]
        : tools;

      return {
        ...rest,
        tools: xaiTools,
        text: mapResponseFormatToResponsesText(response_format, text),
        include: ['reasoning.encrypted_content'],
      } as any;
    },
  },
});
