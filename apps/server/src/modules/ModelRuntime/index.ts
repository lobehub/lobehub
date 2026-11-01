import { type GoogleGenAIOptions } from '@google/genai';
import type { ServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES } from '@lobechat/heterogeneous-agents';
import {
  AgentRuntimeError,
  AgentRuntimeErrorType,
  mergeModelRuntimeHooks,
  ModelRuntime,
  type ModelRuntimeHooks,
  setInlineImageNormalizer,
} from '@lobechat/model-runtime';
import { isResponsesAPIModel } from '@lobechat/model-runtime/providers/openai/modelId';
import { LobeVertexAI } from '@lobechat/model-runtime/vertexai';
import {
  type AWSBedrockKeyVault,
  type AzureOpenAIKeyVault,
  ChatErrorType,
  type ClientSecretPayload,
  type CloudflareKeyVault,
  type ComfyUIKeyVault,
  type GithubCopilotKeyVault,
  type OAuthDeviceFlowKeyVault,
  type OpenAICompatibleKeyVault,
  type ServerDefaultHeterogeneousModelDescriptor,
  type SuperGrokKeyVault,
  type VertexAIKeyVault,
} from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import type { AiFullModelCard } from 'model-bank';
import { isAiModelVisible, ModelProvider } from 'model-bank';
import { AiProviderBaseURLSchema } from 'model-bank/aiProvider';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { AiProviderModel } from '@/database/models/aiProvider';
import { type LobeChatDatabase } from '@/database/type';
import { getLLMConfig } from '@/envs/llm';
import { getServerAiProviderConfig } from '@/server/globalConfig';
import { createLLMGenerationTracingHook } from '@/server/services/llmGenerationTracing/hook';
import { ensureFreshOAuthToken } from '@/server/services/oauthDeviceFlow/refresh';

import { KeyVaultsGateKeeper } from '../KeyVaultsEncrypt';
import apiKeyManager from './apiKeyManager';
import { sharpInlineImageNormalizer } from './inlineImageNormalizer';

// Server requests can re-encode oversized images instead of dropping them.
setInlineImageNormalizer(sharpInlineImageNormalizer);

export * from './trace';
export type { ServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
export { SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES } from '@lobechat/heterogeneous-agents';

/**
 * Combined KeyVaults type for all providers
 */
type ProviderKeyVaults = OpenAICompatibleKeyVault &
  AzureOpenAIKeyVault &
  AWSBedrockKeyVault &
  CloudflareKeyVault &
  ComfyUIKeyVault &
  GithubCopilotKeyVault &
  OAuthDeviceFlowKeyVault &
  SuperGrokKeyVault &
  VertexAIKeyVault;

/**
 * Resolve the runtime provider for a given provider.
 *
 * This is the server-side equivalent of the frontend's resolveRuntimeProvider function.
 * For builtin providers, returns the provider as-is.
 * For custom providers, returns the sdkType from settings (defaults to 'openai').
 *
 * @param provider - The provider id
 * @param sdkType - The sdkType from provider settings
 * @returns The resolved runtime provider
 */
export const resolveRuntimeProvider = (provider: string, sdkType?: string): string => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as ModelProvider);
  if (isBuiltin) return provider;

  return sdkType || 'openai';
};

/**
 * Build ClientSecretPayload from keyVaults stored in database
 *
 * This is the server-side equivalent of the frontend's getProviderAuthPayload function.
 * It converts the keyVaults object from database to the ClientSecretPayload format
 * expected by initModelRuntimeWithUserPayload.
 *
 * For custom providers, we use runtimeProvider (sdkType) to determine which fields
 * to include in the payload. This ensures that provider-specific fields like
 * cloudflareBaseURLOrAccountID are correctly forwarded.
 *
 * @param keyVaults - The keyVaults object from database (already decrypted)
 * @param runtimeProvider - The runtime provider (sdkType) to use for building payload
 * @returns ClientSecretPayload for the provider
 */
export const buildPayloadFromKeyVaults = (
  keyVaults: ProviderKeyVaults,
  runtimeProvider: string,
): ClientSecretPayload => {
  // Use runtimeProvider to determine which fields to include
  // This handles both builtin providers and custom providers with sdkType
  switch (runtimeProvider) {
    case ModelProvider.Bedrock: {
      const { accessKeyId, apiKey, region, secretAccessKey, sessionToken } = keyVaults;

      return {
        apiKey,
        awsAccessKeyId: accessKeyId,
        awsRegion: region,
        awsSecretAccessKey: secretAccessKey,
        awsSessionToken: sessionToken,
        runtimeProvider,
      };
    }

    case ModelProvider.Azure: {
      return {
        apiKey: keyVaults.apiKey,
        baseURL: keyVaults.baseURL || keyVaults.endpoint,
        runtimeProvider,
      };
    }

    case ModelProvider.Ollama: {
      return { baseURL: keyVaults.baseURL, runtimeProvider };
    }

    case ModelProvider.Cloudflare: {
      return {
        apiKey: keyVaults.apiKey,
        cloudflareBaseURLOrAccountID: keyVaults.baseURLOrAccountID,
        runtimeProvider,
      };
    }

    case ModelProvider.ComfyUI: {
      return {
        apiKey: keyVaults.apiKey,
        authType: keyVaults.authType,
        baseURL: keyVaults.baseURL,
        customHeaders: keyVaults.customHeaders,
        password: keyVaults.password,
        runtimeProvider,
        username: keyVaults.username,
      };
    }

    case ModelProvider.VertexAI: {
      return {
        apiKey: keyVaults.apiKey,
        baseURL: keyVaults.baseURL,
        runtimeProvider,
        vertexAIRegion: keyVaults.region,
      };
    }

    case ModelProvider.GithubCopilot: {
      // Support both traditional PAT (apiKey) and OAuth tokens
      return {
        apiKey: keyVaults.apiKey,
        bearerToken: keyVaults.bearerToken,
        bearerTokenExpiresAt: keyVaults.bearerTokenExpiresAt
          ? Number(keyVaults.bearerTokenExpiresAt)
          : undefined,
        oauthAccessToken: keyVaults.oauthAccessToken,
        runtimeProvider,
      };
    }

    case ModelProvider.SuperGrok: {
      // OAuth-only provider: the (already refreshed) access token IS the
      // bearer credential for api.x.ai — expose it as apiKey so the runtime
      // stays a stateless OpenAI-compatible client.
      return {
        apiKey: keyVaults.oauthAccessToken,
        runtimeProvider,
      };
    }

    case ModelProvider.ChatGPT: {
      return {
        apiKey: keyVaults.oauthAccessToken,
        chatgptAccountId: keyVaults.oauthAccountId,
        runtimeProvider,
      };
    }

    default: {
      return {
        apiKey: keyVaults.apiKey,
        baseURL: keyVaults.baseURL,
        runtimeProvider,
      };
    }
  }
};

// Deployment credentials are only valid for the deployment-owned provider and endpoint.
// A custom provider's SDK type does not grant access to that SDK provider's secrets.
const canUseServerProviderConfig = (provider: string, payload: ClientSecretPayload) =>
  Object.values(ModelProvider).includes(provider as ModelProvider) &&
  (!payload.runtimeProvider || payload.runtimeProvider === provider) &&
  !payload.baseURL &&
  !payload.cloudflareBaseURLOrAccountID;

/**
 * Retrieves the options object from environment and apikeymanager
 * based on the provider and payload.
 *
 * @param provider - The model provider.
 * @param payload - The JWT payload.
 * @returns The options object.
 */
const getParamsFromPayload = (provider: string, payload: ClientSecretPayload) => {
  const useServerConfig = canUseServerProviderConfig(provider, payload);
  const llmConfig = (useServerConfig ? getLLMConfig() : {}) as Record<string, any>;
  const runtimeProvider = payload.runtimeProvider ?? provider;

  switch (runtimeProvider) {
    case ModelProvider.LobeHub: {
      return { apikey: payload.apiKey, baseURL: payload.baseURL, ...payload };
    }

    case ModelProvider.VertexAI: {
      return {};
    }

    default: {
      const upperProvider = runtimeProvider.toUpperCase();

      const apiKey = apiKeyManager.pick(payload?.apiKey || llmConfig[`${upperProvider}_API_KEY`]);
      const baseURL =
        payload?.baseURL ||
        (useServerConfig ? process.env[`${upperProvider}_PROXY_URL`] : undefined);

      return baseURL ? { apiKey, baseURL } : { apiKey };
    }

    case ModelProvider.Ollama: {
      const baseURL =
        payload?.baseURL || (useServerConfig ? process.env.OLLAMA_PROXY_URL : undefined);

      return { baseURL };
    }

    case ModelProvider.Azure: {
      const { AZURE_API_KEY, AZURE_ENDPOINT } = llmConfig;
      const apiKey = apiKeyManager.pick(payload?.apiKey || AZURE_API_KEY);
      const baseURL = payload?.baseURL || AZURE_ENDPOINT;
      return { apiKey, baseURL };
    }

    case ModelProvider.AzureAI: {
      const { AZUREAI_ENDPOINT, AZUREAI_ENDPOINT_KEY } = llmConfig;
      const apiKey = payload?.apiKey || AZUREAI_ENDPOINT_KEY;
      const baseURL = payload?.baseURL || AZUREAI_ENDPOINT;
      return { apiKey, baseURL };
    }

    case ModelProvider.Bedrock: {
      const { AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID, AWS_REGION, AWS_SESSION_TOKEN } = llmConfig;

      const hasUserBedrockAuth = !!(
        payload.apiKey ||
        payload.awsAccessKeyId ||
        payload.awsSecretAccessKey
      );

      if (hasUserBedrockAuth) {
        return {
          accessKeyId: payload.awsAccessKeyId,
          accessKeySecret: payload.awsSecretAccessKey,
          apiKey: apiKeyManager.pick(payload.apiKey),
          region: payload.awsRegion || AWS_REGION,
          sessionToken: payload.awsSessionToken,
        };
      }

      const accessKeyId: string | undefined = AWS_ACCESS_KEY_ID;
      const accessKeySecret: string | undefined = AWS_SECRET_ACCESS_KEY;
      const region = payload.awsRegion || AWS_REGION;
      const sessionToken: string | undefined = payload.awsSessionToken || AWS_SESSION_TOKEN;

      return { accessKeyId, accessKeySecret, region, sessionToken };
    }

    case ModelProvider.Cloudflare: {
      const { CLOUDFLARE_API_KEY, CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID } = llmConfig;

      const apiKey = apiKeyManager.pick(payload?.apiKey || CLOUDFLARE_API_KEY);
      const baseURLOrAccountID =
        payload.cloudflareBaseURLOrAccountID || CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID;

      return { apiKey, baseURLOrAccountID };
    }

    case ModelProvider.GithubCopilot: {
      // Support both traditional PAT (apiKey) and OAuth tokens
      return {
        apiKey: payload.apiKey,
        bearerToken: payload.bearerToken,
        bearerTokenExpiresAt: payload.bearerTokenExpiresAt,
        oauthAccessToken: payload.oauthAccessToken,
      };
    }

    case ModelProvider.SuperGrok: {
      // OAuth-only: never fall back to env API keys
      return { apiKey: payload.apiKey };
    }

    case ModelProvider.ChatGPT: {
      return {
        apiKey: payload.apiKey,
        chatgptAccountId: payload.chatgptAccountId,
      };
    }

    case ModelProvider.ComfyUI: {
      const {
        COMFYUI_BASE_URL,
        COMFYUI_AUTH_TYPE,
        COMFYUI_API_KEY,
        COMFYUI_USERNAME,
        COMFYUI_PASSWORD,
        COMFYUI_CUSTOM_HEADERS,
      } = llmConfig;

      // ComfyUI specific handling with environment variables fallback
      const baseURL = payload?.baseURL || COMFYUI_BASE_URL || 'http://127.0.0.1:8000';

      // ComfyUI supports multiple auth types: none, basic, bearer, custom
      // Extract all relevant auth fields from the payload or environment
      const authType = payload?.authType || COMFYUI_AUTH_TYPE || 'none';
      const apiKey = payload?.apiKey || COMFYUI_API_KEY;
      const username = payload?.username || COMFYUI_USERNAME;
      const password = payload?.password || COMFYUI_PASSWORD;

      // Parse customHeaders from JSON string (similar to Vertex AI credentials handling)
      // Support both payload object and environment variable JSON string
      const customHeaders = payload?.customHeaders || safeParseJSON(COMFYUI_CUSTOM_HEADERS);

      // Return all authentication parameters
      return {
        apiKey,
        authType,
        baseURL,
        customHeaders,
        password,
        username,
      };
    }

    case ModelProvider.GiteeAI: {
      const { GITEE_AI_API_KEY } = llmConfig;

      const apiKey = apiKeyManager.pick(payload?.apiKey || GITEE_AI_API_KEY);

      return { apiKey };
    }

    case ModelProvider.Github: {
      const { GITHUB_TOKEN } = llmConfig;

      const apiKey = apiKeyManager.pick(payload?.apiKey || GITHUB_TOKEN);

      return { apiKey };
    }

    case ModelProvider.OllamaCloud: {
      const { OLLAMA_CLOUD_API_KEY } = llmConfig;

      const apiKey = apiKeyManager.pick(payload?.apiKey || OLLAMA_CLOUD_API_KEY);

      return { apiKey };
    }

    case ModelProvider.TencentCloud: {
      const { TENCENT_CLOUD_API_KEY } = llmConfig;

      const apiKey = apiKeyManager.pick(payload?.apiKey || TENCENT_CLOUD_API_KEY);

      return { apiKey };
    }
  }
};

const buildVertexOptions = (
  payload: ClientSecretPayload,
  params: Partial<GoogleGenAIOptions>,
  useServerConfig: boolean,
): GoogleGenAIOptions => {
  const rawCredentials =
    payload.apiKey || (useServerConfig ? process.env.VERTEXAI_CREDENTIALS : undefined) || '';
  const credentials = safeParseJSON<Record<string, string>>(rawCredentials);

  const projectFromParams = params.project as string | undefined;
  const projectFromCredentials = credentials?.project_id;
  const projectFromEnv = useServerConfig ? process.env.VERTEXAI_PROJECT : undefined;

  const project = projectFromParams || projectFromCredentials || projectFromEnv;
  const location =
    (params.location as string | undefined) ||
    payload.vertexAIRegion ||
    (useServerConfig ? process.env.VERTEXAI_LOCATION : undefined) ||
    undefined;

  const googleAuthOptions = params.googleAuthOptions || (credentials ? { credentials } : undefined);

  // Without explicit user credentials Google auth would load the server's ambient credentials.
  if (!useServerConfig && !googleAuthOptions && !params.apiKey) {
    throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);
  }

  const options: GoogleGenAIOptions = {
    ...params,
    vertexai: true,
  };

  if (googleAuthOptions) options.googleAuthOptions = googleAuthOptions;
  if (project) options.project = project;
  if (location) options.location = location as GoogleGenAIOptions['location'];

  return options;
};

/**
 * Initializes the agent runtime with the user payload in backend
 * @param provider - The provider name.
 * @param payload - The JWT payload.
 * @param params
 * @returns A promise that resolves when the agent runtime is initialized.
 */
export const initModelRuntimeWithUserPayload = (
  provider: string,
  payload: ClientSecretPayload,
  params: any = {},
  hooks?: ModelRuntimeHooks,
) => {
  const runtimeProvider = payload.runtimeProvider ?? provider;

  /**
   * User-configured endpoints can come from older clients or persisted rows that predate
   * input validation. Reject them before an SDK appends a request path and throws an
   * unclassified ERR_INVALID_URL, which would otherwise surface as a server-side 500.
   */
  if (payload.baseURL && !AiProviderBaseURLSchema.safeParse(payload.baseURL).success) {
    throw AgentRuntimeError.createError(ChatErrorType.BadRequest, {
      message: 'Invalid provider baseURL',
    });
  }

  if (runtimeProvider === ModelProvider.VertexAI) {
    const vertexOptions = buildVertexOptions(
      payload,
      params,
      canUseServerProviderConfig(provider, payload),
    );
    const runtime = LobeVertexAI.initFromVertexAI(vertexOptions);

    return new ModelRuntime(runtime, hooks);
  }

  return ModelRuntime.initializeWithProvider(
    runtimeProvider,
    {
      ...getParamsFromPayload(provider, payload),
      ...params,
    },
    hooks,
  );
};

/**
 * Initialize ModelRuntime by reading user's provider configuration from database
 *
 * This function replaces the pattern of passing userPayload from frontend.
 * It reads the user's AI provider configuration from the database, decrypts
 * the keyVaults, and initializes the ModelRuntime.
 *
 * @param db - The database instance
 * @param userId - The user ID
 * @param provider - The model provider (e.g., 'openai', 'azure')
 * @returns Promise<ModelRuntime> - The initialized ModelRuntime instance
 *
 * @example
 * ```typescript
 * const modelRuntime = await initModelRuntimeFromDB(db, userId, 'openai');
 * const response = await modelRuntime.chat({ messages, model });
 * ```
 */
export const initModelRuntimeFromDB = async (
  db: LobeChatDatabase,
  userId: string,
  provider: string,
  workspaceId?: string,
): Promise<ModelRuntime> => {
  // 1. Get user's provider configuration from database
  const aiProviderModel = new AiProviderModel(db, userId, workspaceId);

  // Use getAiProviderById with KeyVaultsGateKeeper.getUserKeyVaults as decryptor
  const providerConfig = await aiProviderModel.getAiProviderById(
    provider,
    KeyVaultsGateKeeper.getUserKeyVaults,
  );

  // 2. Resolve the runtime provider for custom providers
  // For custom providers, use sdkType from settings (defaults to 'openai')
  const sdkType = providerConfig?.settings?.sdkType;
  const runtimeProvider = resolveRuntimeProvider(provider, sdkType);

  // 3. Build ClientSecretPayload from keyVaults based on runtimeProvider
  // This ensures provider-specific fields (e.g., cloudflareBaseURLOrAccountID) are included
  let keyVaults = (providerConfig?.keyVaults || {}) as ProviderKeyVaults;

  // 3.5. OAuth device-flow providers with rotating refresh tokens (e.g.
  // SuperGrok): proactively refresh + persist the token pair before building
  // the payload. Mounted here because every server-side LLM call path (webapi
  // chat, agent runtime transport, async image/video, lambda routers)
  // converges on this function.
  const oauthDeviceFlowConfig = DEFAULT_MODEL_PROVIDER_LIST.find((p) => p.id === provider)?.settings
    ?.oauthDeviceFlow;
  if (oauthDeviceFlowConfig?.refreshTokenGrant) {
    const freshKeyVaults = await ensureFreshOAuthToken({
      config: oauthDeviceFlowConfig,
      db,
      keyVaults,
      providerId: provider,
      userId,
      workspaceId,
    });
    keyVaults = { ...keyVaults, ...freshKeyVaults } as ProviderKeyVaults;
  }

  const payload = buildPayloadFromKeyVaults(keyVaults, runtimeProvider);

  // 4. Get business hooks (billing in cloud, undefined in OSS)
  const businessHooks = getBusinessModelRuntimeHooks(userId, provider, workspaceId);

  // 5. Compose with the per-call llm_generation_tracing hook (no-op when the
  //    service is unconfigured, so OSS / self-hosted setups pay nothing for it).
  const tracingHooks = createLLMGenerationTracingHook(userId, provider, workspaceId);
  const hooks = mergeModelRuntimeHooks(businessHooks, tracingHooks);

  // 6. Initialize ModelRuntime with the payload and hooks
  return initModelRuntimeWithUserPayload(provider, payload, { userId, workspaceId }, hooks);
};

/**
 * The provider-level “使用 Responses API 规范” switch (`ai_providers.config.enableResponseApi`).
 *
 * The browser runtime resolves it per request in `services/chat#getChatCompletion`, which
 * sets `apiMode` to `'responses'` or `'chatCompletion'`. A gateway / server-executed run
 * builds its own chat payload and never sees that field, so the switch silently lost to
 * the model default and every request landed on `/v1/chat/completions`. Resolving it from
 * the provider row keeps both execution sites on the same wire protocol.
 *
 * `undefined` means the user never expressed a preference: the model-runtime decides
 * (see `isResponsesAPIModel`), which is the pre-existing behaviour.
 */
export type ProviderResponseApiMode = 'responses' | 'chatCompletion';

export const resolveProviderResponseApiMode = async (
  db: LobeChatDatabase,
  userId: string,
  provider: string,
  workspaceId?: string,
): Promise<ProviderResponseApiMode | undefined> => {
  try {
    const providerConfig = await new AiProviderModel(db, userId, workspaceId).getAiProviderById(
      provider,
    );

    const enableResponseApi = providerConfig?.config?.enableResponseApi;

    if (typeof enableResponseApi !== 'boolean') return undefined;

    return enableResponseApi ? 'responses' : 'chatCompletion';
  } catch (error) {
    // A provider-config read must never fail a run: fall back to the model default.
    console.error('[ModelRuntime] Failed to resolve provider response api mode:', error);

    return undefined;
  }
};

export interface ServerDefaultHeterogeneousModelReference {
  model: string;
}

export type ServerDefaultHeterogeneousModels = Record<
  ServerDefaultHeterogeneousAgentType,
  ServerDefaultHeterogeneousModelReference[]
>;

/**
 * Every supported CLI uses the single LobeHub relay provider. `lobehub` is a
 * deployment-owned router slot, not a hosted-only upstream: official and
 * private distributions provide their own model catalog and RouterRuntime
 * behind it.
 *
 * The shared agent matrix selects either the Anthropic Messages or OpenAI
 * Responses ingress. Both translate the wire protocol in both directions
 * rather than proxying it, and every CLI addresses the relay as
 * `lobehub/${catalogId}`. The operation token remains the source of truth and
 * the request must match that selection.
 *
 * Every CLI accepts the same enabled, visible chat models unless the catalog
 * explicitly marks tool calling as unsupported. Missing capability metadata
 * and custom model IDs do not disqualify a model or prove CLI compatibility.
 */
const isServerDefaultHeterogeneousModelCandidate = (
  model: Pick<AiFullModelCard, 'abilities' | 'visible'>,
) => isAiModelVisible(model) && model.abilities?.functionCall !== false;

const getEnabledServerChatModels = async (provider: ModelProvider) => {
  const providerConfig = await getServerAiProviderConfig(provider);
  if (!providerConfig?.enabled) return [];

  return providerConfig.serverModelLists.filter((model) => model.enabled && model.type === 'chat');
};

const findEnabledServerChatModel = async (provider: string, model: string) => {
  if (!Object.values(ModelProvider).includes(provider as ModelProvider)) {
    throw new Error('Deployment-level custom providers are not supported for server agents');
  }
  const modelConfig = (await getEnabledServerChatModels(provider as ModelProvider)).find(
    (item) => item.id === model,
  );
  if (!modelConfig) {
    throw new Error('The selected server model is not available');
  }

  return modelConfig;
};

const toServerModelSelection = (provider: string, modelConfig: AiFullModelCard) => ({
  ...(modelConfig.config?.deploymentName && {
    deploymentName: modelConfig.config.deploymentName,
  }),
  model: modelConfig.id,
  provider,
});

/** Return visible chat models from the single deployment-owned relay provider. */
export const getServerDefaultHeterogeneousModels = async () => {
  const models = {} as ServerDefaultHeterogeneousModels;
  for (const agentType of SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES) {
    models[agentType] = [];
  }

  for (const model of await getEnabledServerChatModels(ModelProvider.LobeHub)) {
    if (!isServerDefaultHeterogeneousModelCandidate(model)) continue;
    for (const agentType of SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES) {
      models[agentType].push({ model: model.id });
    }
  }

  return models;
};

/** Resolve a user selection against the deployment-owned, enabled chat model catalog. */
export const resolveServerModel = async (provider: string, model: string) =>
  toServerModelSelection(provider, await findEnabledServerChatModel(provider, model));

const findServerDefaultHeterogeneousModel = async (model: string) => {
  const modelConfig = await findEnabledServerChatModel(ModelProvider.LobeHub, model);
  if (!isServerDefaultHeterogeneousModelCandidate(modelConfig)) {
    throw new Error('The selected server model is not compatible with this heterogeneous agent');
  }
  return modelConfig;
};

/** Describe a compatible model so a CLI can be told about one it has no entry for. */
export const describeServerDefaultHeterogeneousModel = async (
  _agentType: ServerDefaultHeterogeneousAgentType,
  model: string,
): Promise<ServerDefaultHeterogeneousModelDescriptor> => {
  const modelConfig = await findServerDefaultHeterogeneousModel(model);
  return {
    abilities: {
      reasoning: modelConfig.abilities?.reasoning === true,
      vision: modelConfig.abilities?.vision === true,
    },
    ...(modelConfig.contextWindowTokens && {
      contextWindowTokens: modelConfig.contextWindowTokens,
    }),
    ...(modelConfig.displayName && { displayName: modelConfig.displayName }),
    ...(modelConfig.maxOutput && { maxOutput: modelConfig.maxOutput }),
    model: modelConfig.id,
    nativeResponses: isResponsesAPIModel(modelConfig.id),
  };
};

/** Resolve a model only when it belongs to the selected CLI's relay runtime path. */
export const resolveServerDefaultHeterogeneousModel = async (
  _agentType: ServerDefaultHeterogeneousAgentType,
  model: string,
) => {
  const modelConfig = await findServerDefaultHeterogeneousModel(model);

  return {
    ...toServerModelSelection(ModelProvider.LobeHub, modelConfig),
    ...(modelConfig.maxOutput !== undefined && { maxOutput: modelConfig.maxOutput }),
    supportsAdaptiveThinking:
      modelConfig.settings?.extendParams?.includes('enableAdaptiveThinking') === true,
  };
};

/**
 * Initialize the deployment's single relay directly.
 *
 * Do not resolve `DEFAULT_AGENT_CONFIG` here or translate this into OpenAI /
 * Anthropic environment credentials. Those names describe the two CLI ingress
 * protocols only; the deployment-owned LobeHub RouterRuntime owns the one
 * upstream endpoint, credentials, model routing, fallback, and billing policy.
 */
export const initModelRuntimeFromServerConfig = async (params: {
  actorUserId: string;
  workspaceId?: string;
}): Promise<ModelRuntime> => {
  const businessHooks = getBusinessModelRuntimeHooks(
    params.actorUserId,
    ModelProvider.LobeHub,
    params.workspaceId,
  );
  const tracingHooks = createLLMGenerationTracingHook(
    params.actorUserId,
    ModelProvider.LobeHub,
    params.workspaceId,
  );
  return ModelRuntime.initializeWithProvider(
    ModelProvider.LobeHub,
    { userId: params.actorUserId, workspaceId: params.workspaceId },
    mergeModelRuntimeHooks(businessHooks, tracingHooks),
  );
};
