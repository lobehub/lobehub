import { IMAGE_GENERATION_MODEL_WHITELIST, ModelProvider } from 'model-bank';

import {
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
  createDefaultAnthropicClient,
} from '../../core/anthropicCompatible';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { type ModelIdMappingOptions, resolveMappedModelId } from '../../utils/modelIdMapping';
import { aceChatProtocol, isOfficialAceEndpoint, loadAceCatalog } from './catalog';

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

    if (isOfficialAceEndpoint(client.baseURL)) {
      const available = new Set(data.map(({ id }) => id));
      return (await loadAceCatalog())
        .filter((model) => available.has(model.id))
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

const AceMessagesAI = createAnthropicCompatibleRuntime(
  createAnthropicCompatibleParams({
    baseURL: 'https://api.acedata.cloud',
    customClient: {
      createClient: (options) =>
        createDefaultAnthropicClient({ ...options, apiKey: null, authToken: options.apiKey }),
    },
    provider: ModelProvider.AceDataCloud,
  }),
);

const AceChatAI = createOpenAICompatibleRuntime(params);

export class LobeAceDataCloudAI extends AceChatAI {
  private requestModelMapping: ModelIdMappingOptions;

  constructor(options: NonNullable<ConstructorParameters<typeof AceChatAI>[0]> = {}) {
    super(options);
    this.requestModelMapping = { modelIdMapping: options.modelIdMapping };
  }

  private async publishedProtocol(model: string) {
    if (!isOfficialAceEndpoint(this.baseURL)) return;
    const requestModel = resolveMappedModelId(model, this.requestModelMapping);
    const metadata = (await loadAceCatalog()).find((item) => item.id === requestModel);
    return metadata ? aceChatProtocol(metadata) : undefined;
  }

  private messagesRuntime() {
    return new AceMessagesAI({
      ...this._options,
      ...this.requestModelMapping,
      baseURL: 'https://api.acedata.cloud',
    });
  }

  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    const protocol = await this.publishedProtocol(payload.model);
    if (protocol === 'messages') return this.messagesRuntime().chat(payload, options);
    return super.chat(
      protocol === 'responses' ? { ...payload, apiMode: 'responses' } : payload,
      options,
    );
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    const protocol = await this.publishedProtocol(payload.model);
    if (protocol === 'messages') return this.messagesRuntime().generateObject(payload, options);
    return super.generateObject(
      protocol === 'responses' ? { ...payload, responseApi: true } : payload,
      options,
    );
  }
}
