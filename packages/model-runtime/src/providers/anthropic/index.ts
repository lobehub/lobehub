import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';
import { supportsClaudeEffortLevel } from './modelId';

const buildAnthropicPayload = (payload: ChatStreamPayload) => {
  const reasoningEffort = supportsClaudeEffortLevel(payload.model, payload.reasoning_effort)
    ? payload.reasoning_effort
    : undefined;
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
