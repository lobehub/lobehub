import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';
import { resolveAnthropicEffort } from './modelId';

const buildAnthropicPayload = (payload: ChatStreamPayload) =>
  buildDefaultAnthropicPayload({
    ...payload,
    effort: resolveAnthropicEffort(payload.model, payload.effort, payload.reasoning_effort),
    messages: normalizeClaudeThinkingHistoryMessages(payload.messages),
  });

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
