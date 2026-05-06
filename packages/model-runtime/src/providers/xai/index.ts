import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatCompletionTool, ChatResponseFormat, ChatStreamPayload } from '../../types';
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasSlashDelimitedEnumValue = (value: unknown) =>
  Array.isArray(value) && value.some((item) => typeof item === 'string' && item.includes('/'));

/**
 * xAI Responses rejects some otherwise valid JSON Schema constraints in function tools.
 * Keep the tool usable by removing only slash-delimited enum constraints, such as MIME
 * values (`text/plain`) from Gmail MCP schemas.
 */
const sanitizeXAIToolSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map((item) => sanitizeXAIToolSchema(item));

  if (!isRecord(schema)) return schema;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'enum' && hasSlashDelimitedEnumValue(value)) continue;

    sanitized[key] = sanitizeXAIToolSchema(value);
  }

  return sanitized;
};

const sanitizeXAITools = (tools?: ChatCompletionTool[]) =>
  tools?.map((tool) => {
    if (!tool.function.parameters) return tool;

    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: sanitizeXAIToolSchema(
          tool.function.parameters,
        ) as ChatCompletionTool['function']['parameters'],
      },
    };
  });

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
      const sanitizedTools = sanitizeXAITools(tools);

      const xaiTools = enabledSearch
        ? [...(sanitizedTools || []), { type: 'web_search' }, { type: 'x_search' }]
        : sanitizedTools;

      return {
        ...rest,
        tools: xaiTools,
        text: mapResponseFormatToResponsesText(response_format, text),
        include: ['reasoning.encrypted_content'],
      } as any;
    },
  },
});
