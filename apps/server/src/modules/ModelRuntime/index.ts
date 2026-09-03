import { type GoogleGenAIOptions } from '@google/genai';
import type { ServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import {
  isServerDefaultHeterogeneousProfileModel,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES,
} from '@lobechat/heterogeneous-agents';
import {
  AgentRuntimeError,
  mergeModelRuntimeHooks,
  ModelRuntime,
  type ModelRuntimeHooks,
} from '@lobechat/model-runtime';
import { parseClaudeModelId } from '@lobechat/model-runtime/providers/anthropic/modelId';
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
  type SuperGrokKeyVault,
  type VertexAIKeyVault,
} from '@lobechat/types';
import { isCodexServerDefaultCustomModel } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import type { AiFullModelCard } from 'model-bank';
import { isAiModelVisible, ModelProvider } from 'model-bank';
import { AiProviderBaseURLSchema } from 'model-bank/aiProvider';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { AiProviderModel } from '@/database/models/aiProvider';
import { type LobeChatDatabase } from '@/database/type';
import { getLLMConfig } from '@/envs/llm';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { createLLMGenerationTracingHook } from '@/server/services/llmGenerationTracing/hook';
import { ensureFreshOAuthToken } from '@/server/services/oauthDeviceFlow/refresh';

import { KeyVaultsGateKeeper } from '../KeyVaultsEncrypt';
import apiKeyManager from './apiKeyManager';

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
const resolveRuntimeProvider = (provider: string, sdkType?: string): string => {
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

/**
 * Retrieves the options object from environment and apikeymanager
 * based on the provider and payload.
 *
 * @param provider - The model provider.
 * @param payload - The JWT payload.
 * @returns The options object.
 */
const getParamsFromPayload = (provider: string, payload: ClientSecretPayload) => {
  const llmConfig = getLLMConfig() as Record<string, any>;

  switch (provider) {
    case ModelProvider.LobeHub: {
      return { apikey: payload.apiKey, baseURL: payload.baseURL, ...payload };
    }

    case ModelProvider.VertexAI: {
      return {};
    }

    default: {
      let upperProvider = provider.toUpperCase();

      if (!(`${upperProvider}_API_KEY` in llmConfig)) {
        upperProvider = ModelProvider.OpenAI.toUpperCase(); // Use OpenAI options as default
      }

      const apiKey = apiKeyManager.pick(payload?.apiKey || llmConfig[`${upperProvider}_API_KEY`]);
      const baseURL = payload?.baseURL || process.env[`${upperProvider}_PROXY_URL`];

      return baseURL ? { apiKey, baseURL } : { apiKey };
    }

    case ModelProvider.Ollama: {
      const baseURL = payload?.baseURL || process.env.OLLAMA_PROXY_URL;

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
        payload.apiKey && payload.cloudflareBaseURLOrAccountID
          ? payload.cloudflareBaseURLOrAccountID
          : CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID;

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
  params: Partial<GoogleGenAIOptions> = {},
): GoogleGenAIOptions => {
  const rawCredentials = payload.apiKey || process.env.VERTEXAI_CREDENTIALS || '';
  const credentials = safeParseJSON<Record<string, string>>(rawCredentials);

  const projectFromParams = params.project as string | undefined;
  const projectFromCredentials = credentials?.project_id;
  const projectFromEnv = process.env.VERTEXAI_PROJECT;

  const project = projectFromParams || projectFromCredentials || projectFromEnv;
  const location =
    (params.location as string | undefined) ||
    payload.vertexAIRegion ||
    process.env.VERTEXAI_LOCATION ||
    undefined;

  const googleAuthOptions = params.googleAuthOptions || (credentials ? { credentials } : undefined);

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
    const vertexOptions = buildVertexOptions(payload, params);
    const runtime = LobeVertexAI.initFromVertexAI(vertexOptions);

    return new ModelRuntime(runtime, hooks);
  }

  return ModelRuntime.initializeWithProvider(
    runtimeProvider,
    {
      ...getParamsFromPayload(runtimeProvider, payload),
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
 * Legacy agent policies accept any tool-capable chat model; the
 * `parseClaudeModelId` arm keeps Claude ids eligible in deployments whose
 * catalog omits `abilities`. Profile-attested agents instead require a tested
 * client payload/continuation contract. Codex retains its narrower policy: it
 * accepts native Responses models plus an explicit set of tool-capable relay
 * models configured through its custom model-catalog path.
 */
const supportsServerDefaultHeterogeneousAgent = (
  agentType: ServerDefaultHeterogeneousAgentType,
  model: Pick<AiFullModelCard, 'abilities' | 'agentCompatibility' | 'id' | 'visible'>,
) => {
  if (!isAiModelVisible(model)) return false;

  const config = SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG[agentType];
  const { modelPolicy } = config;
  if (modelPolicy === 'tool-capable') {
    return parseClaudeModelId(model.id) !== undefined || model.abilities?.functionCall === true;
  }
  if (modelPolicy === 'profile-attested') {
    if (model.abilities?.functionCall === false) return false;
    const deploymentProfiles = model.agentCompatibility?.serverDefaultHeterogeneousProfiles;
    return deploymentProfiles
      ? deploymentProfiles.includes(config.compatibilityProfile)
      : isServerDefaultHeterogeneousProfileModel(config.compatibilityProfile, model.id);
  }

  return (
    isResponsesAPIModel(model.id) ||
    (isCodexServerDefaultCustomModel(model.id) && model.abilities?.functionCall === true)
  );
};

const getEnabledServerChatModels = async (provider: ModelProvider) => {
  const providerConfig = (await getServerGlobalConfig()).aiProvider[provider];
  if (!providerConfig?.enabled) return [];

  const models =
    providerConfig.serverModelLists ??
    (await loadModels()).filter((model) => model.providerId === provider);

  return models.filter((model) => model.enabled && model.type === 'chat');
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

/** Return compatible models from the single deployment-owned relay provider. */
export const getServerDefaultHeterogeneousModels = async () => {
  const models = {} as ServerDefaultHeterogeneousModels;
  for (const agentType of SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES) {
    models[agentType] = [];
  }

  for (const model of await getEnabledServerChatModels(ModelProvider.LobeHub)) {
    for (const agentType of SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES) {
      if (supportsServerDefaultHeterogeneousAgent(agentType, model)) {
        models[agentType].push({ model: model.id });
      }
    }
  }

  return models;
};

/** Resolve a user selection against the deployment-owned, enabled chat model catalog. */
export const resolveServerModel = async (provider: string, model: string) =>
  toServerModelSelection(provider, await findEnabledServerChatModel(provider, model));

/** Resolve a model only when it belongs to the selected CLI's relay runtime path. */
export const resolveServerDefaultHeterogeneousModel = async (
  agentType: ServerDefaultHeterogeneousAgentType,
  model: string,
) => {
  const modelConfig = await findEnabledServerChatModel(ModelProvider.LobeHub, model);
  if (!supportsServerDefaultHeterogeneousAgent(agentType, modelConfig)) {
    throw new Error('The selected server model is not compatible with this heterogeneous agent');
  }

  return {
    ...toServerModelSelection(ModelProvider.LobeHub, modelConfig),
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
