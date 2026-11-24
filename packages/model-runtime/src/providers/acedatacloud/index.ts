import { IMAGE_GENERATION_MODEL_WHITELIST, ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { AgentRuntimeErrorType } from '../../types/error';
import { isAceChatModel, isOfficialAceEndpoint, loadAceCatalog } from './catalog';

// The Ace /models catalog also includes image and embedding endpoints that
// cannot be selected as a chat model. Keep those services in their own tools.
const NON_CHAT_PREFIXES = ['dall-e-', 'gpt-image-', 'nano-banana', 'text-embedding-'];

const handleAceError = (error: { code?: string; error?: { code?: string }; status?: number }) => {
  if (error?.status === 429) {
    return { error, errorType: AgentRuntimeErrorType.RateLimitExceeded };
  }
  if (error?.status === 403 && (error.code ?? error.error?.code) === 'permission_denied') {
    return { error, errorType: AgentRuntimeErrorType.PermissionDenied };
  }
};

export const params = {
  baseURL: 'https://api.acedata.cloud/v1',
  chatCompletion: {
    // Ace signals throttling with HTTP 429; the generic message parser does not
    // classify every localized or flat compatible error body as a rate limit.
    handleError: handleAceError,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ACEDATACLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { data } = await client.models.list();

    if (isOfficialAceEndpoint(client.baseURL)) {
      const available = new Set(data.map(({ id }) => id));
      return (await loadAceCatalog())
        .filter((model) => available.has(model.id) && isAceChatModel(model))
        .map((model) => ({
          abilities: {
            ...(model.capabilities?.includes('vision') && { vision: true }),
            ...(model.capabilities?.includes('reasoning') && { reasoning: true }),
            ...(model.capabilities?.includes('tool_call') && { functionCall: true }),
          },
          displayName: model.name || model.id,
          id: model.id,
          type: 'chat' as const,
        }));
    }

    // The API catalog is authoritative for IDs, not for account entitlements.
    // Vendor prices and capability heuristics are not Ace API metadata.
    return data
      .filter(
        ({ id }) =>
          !NON_CHAT_PREFIXES.some((prefix) => id.startsWith(prefix)) &&
          !IMAGE_GENERATION_MODEL_WHITELIST.some((suffix) => id.endsWith(suffix)),
      )
      .map(({ id }) => ({ displayName: id, id, type: 'chat' as const }));
  },
  provider: ModelProvider.AceDataCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAceDataCloudAI = createOpenAICompatibleRuntime(params);
