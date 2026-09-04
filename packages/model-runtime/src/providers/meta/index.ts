import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatResponseFormat, ChatStreamPayload } from '../../types';

/**
 * Meta Model API serves the same models over three wire formats, but only the Responses API
 * carries the model's chain of thought between calls and hosts search grounding — Chat
 * Completions does neither. Meta names Responses "the recommended default for new work", so
 * every request is routed there instead of the messages-array endpoint.
 *
 * ref: https://dev.meta.ai/docs/protocols
 */
const handleMetaChatCompletionPayload = (payload: ChatStreamPayload) =>
  ({
    ...payload,
    apiMode: 'responses',
    stream: payload.stream ?? true,
  }) as any;

/**
 * Meta's Responses API takes structured output under `text.format` and rejects the Chat
 * Completions `response_format` shape with HTTP 400, while callers still send the latter.
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

export const handleMetaResponsesPayload = (payload: ChatStreamPayload) => {
  const { enabledSearch, response_format, text, tools, ...rest } = payload;

  return {
    ...rest,
    /**
     * Muse Spark never returns its raw chain of thought — reasoning replay is encrypted-only
     * and `encrypted_content` is omitted unless requested here. The factory already sends
     * `store: false`, which is exactly the stateless replay mode Meta recommends. This must
     * not be combined with `previous_response_id` (HTTP 400), which the factory never sends.
     */
    include: ['reasoning.encrypted_content'],
    text: mapResponseFormatToResponsesText(response_format, text),
    tools: enabledSearch ? [...(tools || []), { type: 'web_search' }] : tools,
  } as any;
};

export const LobeMetaAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.meta.ai/v1',
  chatCompletion: {
    handlePayload: handleMetaChatCompletionPayload,
    useResponse: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_META_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_META_RESPONSES === '1',
  },
  provider: ModelProvider.Meta,
  responses: {
    handlePayload: handleMetaResponsesPayload,
  },
});
