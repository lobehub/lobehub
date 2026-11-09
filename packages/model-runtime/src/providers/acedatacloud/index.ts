import { IMAGE_GENERATION_MODEL_WHITELIST, ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { AgentRuntimeErrorType } from '../../types/error';

// The Ace /models catalog also includes image and embedding endpoints that
// cannot be selected as a chat model. Keep those services in their own tools.
const NON_CHAT_PREFIXES = ['dall-e-', 'gpt-image-', 'nano-banana', 'text-embedding-'];

export const params = {
  baseURL: 'https://api.acedata.cloud/v1',
  chatCompletion: {
    // Ace signals throttling with HTTP 429; the generic message parser does not
    // classify every localized or flat compatible error body as a rate limit.
    handleError: (error) =>
      error?.status === 429
        ? { error, errorType: AgentRuntimeErrorType.RateLimitExceeded }
        : undefined,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ACEDATACLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { data } = await client.models.list();

    // The API catalog is authoritative for IDs, not for account entitlements.
    // Vendor prices and capability heuristics are not Ace API metadata.
    return data
      .filter(
        ({ id }) =>
          id !== 'gpt-4o-image' &&
          !NON_CHAT_PREFIXES.some((prefix) => id.startsWith(prefix)) &&
          !IMAGE_GENERATION_MODEL_WHITELIST.some((suffix) => id.endsWith(suffix)),
      )
      .map(({ id }) => ({ displayName: id, id, type: 'chat' as const }));
  },
  provider: ModelProvider.AceDataCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAceDataCloudAI = createOpenAICompatibleRuntime(params);
