import { type GoogleGenAIOptions } from '@google/genai';
import { ModelRuntime } from '@lobechat/model-runtime';
import { LobeVertexAI } from '@lobechat/model-runtime/vertexai';
import {
  type AWSBedrockKeyVault,
  type AzureOpenAIKeyVault,
  type ClientSecretPayload,
  type CloudflareKeyVault,
  type ComfyUIKeyVault,
  type GithubCopilotKeyVault,
  type OpenAICompatibleKeyVault,
  type VertexAIKeyVault,
} from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { ModelProvider } from 'model-bank';

import { AiProviderModel } from '@/database/models/aiProvider';
import { type LobeChatDatabase } from '@/database/type';
import { getLLMConfig } from '@/envs/llm';

import { KeyVaultsGateKeeper } from '../KeyVaultsEncrypt';
import apiKeyManager from './apiKeyManager';

export * from './trace';

/**
 * Combined KeyVaults type for all providers
 */
type ProviderKeyVaults = OpenAICompatibleKeyVault &
  AzureOpenAIKeyVault &
  AWSBedrockKeyVault &
  CloudflareKeyVault &
  ComfyUIKeyVault &
  GithubCopilotKeyVault &
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
 * cloudflareBaseURLOrAccountID or azureApiVersion are correctly forwarded.
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
      const { accessKeyId, region, secretAccessKey, sessionToken } = keyVaults;
      const apiKey = (secretAccessKey || '') + (accessKeyId || '');

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
        azureApiVersion: keyVaults.apiVersion,
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
      const { AZURE_API_KEY, AZURE_API_VERSION, AZURE_ENDPOINT } = llmConfig;
      const apiKey = apiKeyManager.pick(payload?.apiKey || AZURE_API_KEY);
      const baseURL = payload?.baseURL || AZURE_ENDPOINT;
      const apiVersion = payload?.azureApiVersion || AZURE_API_VERSION;
      return { apiKey, apiVersion, baseURL };
    }

    case ModelProvider.AzureAI: {
      const { AZUREAI_ENDPOINT, AZUREAI_ENDPOINT_KEY } = llmConfig;
      const apiKey = payload?.apiKey || AZUREAI_ENDPOINT_KEY;
      const baseURL = payload?.baseURL || AZUREAI_ENDPOINT;
      return { apiKey, baseURL };
    }

    case ModelProvider.Bedrock: {
      const { AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID, AWS_REGION, AWS_SESSION_TOKEN } = llmConfig;
      let accessKeyId: string | undefined = AWS_ACCESS_KEY_ID;
      let accessKeySecret: string | undefined = AWS_SECRET_ACCESS_KEY;
      let region = AWS_REGION;
      let sessionToken: string | undefined = AWS_SESSION_TOKEN;
      // if the payload has the api key, use user
      if (payload.apiKey) {
        accessKeyId = payload?.awsAccessKeyId;
        accessKeySecret = payload?.awsSecretAccessKey;
        sessionToken = payload?.awsSessionToken;
        region = payload?.awsRegion;
      }
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
) => {
  const runtimeProvider = payload.runtimeProvider ?? provider;

  if (runtimeProvider === ModelProvider.VertexAI) {
    const vertexOptions = buildVertexOptions(payload, params);
    const runtime = LobeVertexAI.initFromVertexAI(vertexOptions);

    return new ModelRuntime(runtime);
  }

  return ModelRuntime.initializeWithProvider(runtimeProvider, {
    ...getParamsFromPayload(runtimeProvider, payload),
    ...params,
  });
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
): Promise<ModelRuntime> => {
  // 1. Get user's provider configuration from database
  const aiProviderModel = new AiProviderModel(db, userId);

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
  const keyVaults = (providerConfig?.keyVaults || {}) as ProviderKeyVaults;
  const payload = buildPayloadFromKeyVaults(keyVaults, runtimeProvider);

  // 4. Initialize ModelRuntime with the payload
  return initModelRuntimeWithUserPayload(provider, payload);
};
