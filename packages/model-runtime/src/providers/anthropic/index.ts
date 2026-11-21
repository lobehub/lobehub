import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
  DEFAULT_ANTHROPIC_BASE_URL,
} from '../../core/anthropicCompatible';
import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';
import { supportsClaudeEffortLevel } from './modelId';

const FIRST_PARTY_HOSTNAME = new URL(DEFAULT_ANTHROPIC_BASE_URL).hostname;

/**
 * Whether requests go to Anthropic's own API, the only endpoint known to take
 * `cache_control.ttl`. A custom base URL (a user's proxy or `ANTHROPIC_PROXY_URL`) may front a
 * gateway that rejects the field, and one rejected breakpoint fails the whole request, so the
 * payload keeps the plain `{ type: 'ephemeral' }` markers there.
 */
export const isFirstPartyAnthropicBaseURL = (baseURL?: string | null): boolean => {
  if (!baseURL) return true;
  try {
    return new URL(baseURL).hostname === FIRST_PARTY_HOSTNAME;
  } catch {
    return false;
  }
};

const buildAnthropicPayload = (payload: ChatStreamPayload, baseURL?: string | null) => {
  const reasoningEffort = supportsClaudeEffortLevel(payload.model, payload.reasoning_effort)
    ? payload.reasoning_effort
    : undefined;
  return buildDefaultAnthropicPayload(
    {
      ...payload,
      effort: payload.effort ?? reasoningEffort,
      messages: normalizeClaudeThinkingHistoryMessages(payload.messages),
    },
    { allowExtendedCacheTTL: isFirstPartyAnthropicBaseURL(baseURL) },
  );
};

export const params = createAnthropicCompatibleParams({
  chatCompletion: {
    // The runtime passes its resolved options: `baseURL` is the endpoint the request goes to.
    handlePayload: (payload, options) => buildAnthropicPayload(payload, options?.baseURL),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Anthropic,
});

export const LobeAnthropicAI = createAnthropicCompatibleRuntime(params);

export default LobeAnthropicAI;
