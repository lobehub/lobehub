import type OpenAI from 'openai';

import type { ChatCompletionTool, ChatStreamPayload } from '../../types';

export const convertChatCompletionToolToResponseTool = (
  tool: ChatCompletionTool,
): OpenAI.Responses.Tool => ({ type: tool.type, ...tool.function }) as OpenAI.Responses.Tool;

/** Remove Chat Completions-only fields before sending a Responses request. */
export const stripChatCompletionParameters = (payload: Partial<ChatStreamPayload>) => {
  const {
    apiMode: _apiMode,
    frequency_penalty: _frequency,
    presence_penalty: _presence,
    preserveThinking: _thinking,
    ...rest
  } = payload;
  return rest;
};
