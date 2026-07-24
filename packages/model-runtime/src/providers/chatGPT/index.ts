import { CURRENT_VERSION } from '@lobechat/const';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { params as openAIParams } from '../openai';

const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const USER_AGENT = `LobeHub/${CURRENT_VERSION}`;

interface ChatGPTClientOptions {
  chatgptAccountId?: string;
}

export const LobeChatGPTAI = createOpenAICompatibleRuntime<ChatGPTClientOptions>({
  baseURL: CHATGPT_CODEX_BASE_URL,
  chatCompletion: {
    useResponse: true,
  },
  customClient: {
    createClient: ({ chatgptAccountId, ...options }) =>
      new OpenAI({
        ...options,
        defaultHeaders: {
          ...options.defaultHeaders,
          ...(chatgptAccountId && { 'ChatGPT-Account-Id': chatgptAccountId }),
          'User-Agent': USER_AGENT,
          'originator': 'lobehub',
          'session-id': crypto.randomUUID(),
          'version': CURRENT_VERSION,
        },
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CHATGPT_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_CHATGPT_RESPONSES === '1',
  },
  provider: ModelProvider.ChatGPT,
  responses: {
    handlePayload: (payload) => {
      const handledPayload = openAIParams.responses?.handlePayload?.(payload) || payload;
      const { service_tier: _serviceTier, ...rest } = handledPayload;

      // The ChatGPT Codex backend manages output limits from the subscription
      // model catalog and rejects the public API's max_output_tokens field.
      return {
        ...rest,
        include: ['reasoning.encrypted_content'],
        max_tokens: undefined,
      };
    },
  },
});
