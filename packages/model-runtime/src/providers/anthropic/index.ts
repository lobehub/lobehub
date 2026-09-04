import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';

const buildAnthropicPayload = (payload: ChatStreamPayload) => {
  const reasoningEffort =
    payload.reasoning_effort === 'none' || payload.reasoning_effort === 'minimal'
      ? undefined
      : payload.reasoning_effort;
  return buildDefaultAnthropicPayload({
    ...payload,
    effort: payload.effort ?? reasoningEffort,
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
