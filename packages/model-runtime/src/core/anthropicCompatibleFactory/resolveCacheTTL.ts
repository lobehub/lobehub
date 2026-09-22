import type Anthropic from '@anthropic-ai/sdk';

import type { ChatStreamPayload } from '../../types';

type CacheTTL = Anthropic.Messages.CacheControlEphemeral['ttl'];

const DEFAULT_CACHE_TTL = '5m' as const;
/**
 * Resolves cache TTL from Anthropic payload or request settings
 * Returns the first valid TTL found in system messages, content blocks or tools
 */

export const resolveCacheTTL = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: {
    messages: Anthropic.MessageCreateParams['messages'];
    system: Anthropic.MessageCreateParams['system'];
    tools?: Anthropic.MessageCreateParams['tools'];
  },
): CacheTTL | undefined => {
  // Check system messages for cache TTL
  if (Array.isArray(anthropicPayload.system)) {
    for (const block of anthropicPayload.system) {
      const ttl = block.cache_control?.ttl;
      if (ttl) return ttl;
    }
  }

  // Check message content blocks for cache TTL
  for (const message of anthropicPayload.messages ?? []) {
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      // Message content blocks might have cache_control property
      const ttl = ('cache_control' in block && block.cache_control?.ttl) as CacheTTL | undefined;
      if (ttl) return ttl;
    }
  }

  // The last tool carries its own cache breakpoint; it can be the only stamped
  // layer left when there is no system prompt and the message breakpoint was
  // removed together with an unsupported assistant prefill.
  for (const tool of anthropicPayload.tools ?? []) {
    const ttl = ('cache_control' in tool && tool.cache_control?.ttl) as CacheTTL | undefined;
    if (ttl) return ttl;
  }

  // Use default TTL if context caching is enabled
  if (requestPayload.enabledContextCaching) {
    return DEFAULT_CACHE_TTL;
  }

  return undefined;
};
