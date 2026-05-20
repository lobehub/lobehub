import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';

const buildAnthropicPayload = (payload: ChatStreamPayload) => {
  return buildDefaultAnthropicPayload({
    ...payload,
    messages: normalizeClaudeThinkingHistoryMessages(payload.messages),
  });
};

export const params = createAnthropicCompatibleParams({
  chatCompletion: {
    handlePayload: buildAnthropicPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Anthropic,
});

export const LobeAnthropicAI = createAnthropicCompatibleRuntime(params);

export default LobeAnthropicAI;
