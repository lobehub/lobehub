import type { AiModelForSelect, EnabledAiModel, ModelSearchImplementType } from 'model-bank';
import { z } from 'zod';

export type ResponseAnimationStyle = 'smooth' | 'fadeIn' | 'none';
export type ResponseAnimation =
  | {
      speed?: number;
      text?: ResponseAnimationStyle;
    }
  | ResponseAnimationStyle;

export const AiProviderSourceEnum = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type AiProviderSourceType = (typeof AiProviderSourceEnum)[keyof typeof AiProviderSourceEnum];

/**
 * Authentication type for AI providers
 */
export const AiProviderAuthTypeEnum = {
  ApiKey: 'apiKey',
  OAuthDeviceFlow: 'oauthDeviceFlow',
} as const;

export type AiProviderAuthType =
  (typeof AiProviderAuthTypeEnum)[keyof typeof AiProviderAuthTypeEnum];

/**
 * OAuth Device Flow configuration
 */
export interface OAuthDeviceFlowConfig {
  /**
   * OAuth client ID
   */
  clientId: string;
  /**
   * Default polling interval in seconds
   * @default 5
   */
  defaultPollingInterval?: number;
  /**
   * URL to request device code
   */
  deviceCodeEndpoint: string;
  /**
   * OAuth scopes
   */
  scopes: string[];
  /**
   * URL to exchange device code for access token
   */
  tokenEndpoint: string;
  /**
   * Optional: Provider-specific token exchange endpoint (e.g., GitHub Copilot)
   */
  tokenExchangeEndpoint?: string;
}

/**
 * OAuth Device Flow tokens stored in keyVaults
 */
export interface OAuthDeviceFlowKeyVault {
  /**
   * Provider-specific bearer token (e.g., Copilot token)
   */
  bearerToken?: string;
  /**
   * Bearer token expiration timestamp (ms)
   */
  bearerTokenExpiresAt?: number;
  /**
   * OAuth access token (e.g., GitHub's ghu_xxx)
   */
  oauthAccessToken?: string;
  /**
   * OAuth token expiration timestamp (ms)
   */
  oauthTokenExpiresAt?: number;
}

/**
 * only when provider use different sdk
 * we will add a type
 */
export const AiProviderSDKEnum = {
  Anthropic: 'anthropic',
  Azure: 'azure',
  AzureAI: 'azureai',
  Bedrock: 'bedrock',
  Cloudflare: 'cloudflare',
  ComfyUI: 'comfyui',
  Google: 'google',
  Huggingface: 'huggingface',
  Ollama: 'ollama',
  Openai: 'openai',
  Qwen: 'qwen',
  Replicate: 'replicate',
  Router: 'router',
  Volcengine: 'volcengine',
} as const;

export type AiProviderSDKType = (typeof AiProviderSDKEnum)[keyof typeof AiProviderSDKEnum];

const AiProviderSdkTypes = [
  'anthropic',
  'comfyui',
  'openai',
  'ollama',
  'azure',
  'azureai',
  'bedrock',
  'cloudflare',
  'google',
  'huggingface',
  'replicate',
  'router',
  'volcengine',
  'qwen',
] as const satisfies readonly AiProviderSDKType[];

export interface AiProviderSettings {
  /**
   * Authentication type for the provider
   * @default 'apiKey'
   */
  authType?: AiProviderAuthType;
  /**
   * whether provider show browser request option by default
   *
   * @default false
   */
  defaultShowBrowserRequest?: boolean;
  /**
   * some provider server like stepfun and aliyun don't support browser request,
   * So we should disable it
   *
   * @default false
   */
  disableBrowserRequest?: boolean;
  /**
   * whether provider support edit model
   *
   * @default true
   */
  modelEditable?: boolean;

  /**
   * OAuth Device Flow configuration
   * Only used when authType is 'oauthDeviceFlow'
   */
  oauthDeviceFlow?: OAuthDeviceFlowConfig;

  proxyUrl?:
    | {
        desc?: string;
        placeholder: string;
        title?: string;
      }
    | false;

  responseAnimation?: ResponseAnimation;
  /**
   * default openai
   */
  sdkType?: AiProviderSDKType;
  searchMode?: ModelSearchImplementType;
  showAddNewModel?: boolean;
  /**
   * whether show api key in the provider config
   * so provider like ollama don't need api key field
   */
  showApiKey?: boolean;
  /**
   * whether show checker in the provider config
   */
  showChecker?: boolean;
  showDeployName?: boolean;
  showModelFetcher?: boolean;
  supportResponsesApi?: boolean;
}

const ResponseAnimationType = z.enum(['smooth', 'fadeIn', 'none']);

const AiProviderAuthTypes = ['apiKey', 'oauthDeviceFlow'] as const;

const OAuthDeviceFlowConfigSchema = z.object({
  clientId: z.string(),
  defaultPollingInterval: z.number().optional(),
  deviceCodeEndpoint: z.string(),
  scopes: z.array(z.string()),
  tokenEndpoint: z.string(),
  tokenExchangeEndpoint: z.string().optional(),
});

const AiProviderSettingsSchema = z.object({
  authType: z.enum(AiProviderAuthTypes).optional(),
  defaultShowBrowserRequest: z.boolean().optional(),
  disableBrowserRequest: z.boolean().optional(),
  modelEditable: z.boolean().optional(),
  oauthDeviceFlow: OAuthDeviceFlowConfigSchema.optional(),
  proxyUrl: z
    .object({
      desc: z.string().optional(),
      placeholder: z.string(),
      title: z.string().optional(),
    })
    .or(z.literal(false))
    .optional(),
  responseAnimation: z
    .object({
      text: ResponseAnimationType.optional(),
      toolsCalling: ResponseAnimationType.optional(),
    })
    .or(ResponseAnimationType)
    .optional(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  searchMode: z.enum(['params', 'internal']).optional(),
  showAddNewModel: z.boolean().optional(),
  showApiKey: z.boolean().optional(),
  showChecker: z.boolean().optional(),
  showDeployName: z.boolean().optional(),
  showModelFetcher: z.boolean().optional(),
  supportResponsesApi: z.boolean().optional(),
});

export interface AiProviderConfig {
  enableResponseApi?: boolean;
}

// create
export const CreateAiProviderSchema = z.object({
  config: z.object({}).passthrough().optional(),
  description: z.string().optional(),
  id: z.string(),
  keyVaults: z.any().optional(),
  logo: z.string().optional(),
  name: z.string(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  settings: AiProviderSettingsSchema.optional(),
  source: z.enum(['builtin', 'custom']),
  // checkModel: z.string().optional(),
  // homeUrl: z.string().optional(),
  // modelsUrl: z.string().optional(),
});

export type CreateAiProviderParams = z.infer<typeof CreateAiProviderSchema>;

// List Query

export interface AiProviderListItem {
  description?: string;
  enabled: boolean;
  id: string;
  logo?: string;
  name?: string;
  sort?: number;
  source: AiProviderSourceType;
}

// Detail Query

export interface AiProviderCard {
  /**
   * the default model that used for connection check
   */
  checkModel?: string;
  config: AiProviderSettings;
  description?: string;
  enabled: boolean;
  enabledChatModels: string[];
  /**
   * provider's website url
   */
  homeUrl?: string;
  id: string;
  logo?: string;
  /**
   * the url show the all models in the provider
   */
  modelsUrl?: string;
  /**
   * the name show for end user
   */
  name: string;
}

export interface AiProviderDetailItem {
  /**
   * the default model that used for connection check
   */
  checkModel?: string;
  description?: string;
  enabled: boolean;
  fetchOnClient?: boolean;
  /**
   * provider's website url
   */
  homeUrl?: string;
  id: string;
  keyVaults?: Record<string, any>;
  logo?: string;
  /**
   * the url show the all models in the provider
   */
  modelsUrl?: string;
  /**
   * the name show for end user
   */
  name: string;
  settings: AiProviderSettings;
  source: AiProviderSourceType;
}

// Update
export const UpdateAiProviderSchema = z.object({
  config: z.object({}).passthrough().optional(),
  description: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
  name: z.string(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  settings: AiProviderSettingsSchema.optional(),
});

export type UpdateAiProviderParams = z.infer<typeof UpdateAiProviderSchema>;

export const UpdateAiProviderConfigSchema = z.object({
  checkModel: z.string().optional(),
  config: z
    .object({
      enableResponseApi: z.boolean().optional(),
    })
    .optional(),
  fetchOnClient: z.boolean().nullable().optional(),
  keyVaults: z
    .record(
      z.string(),
      z.union([
        z.string().optional(),
        z.record(z.string(), z.string()).optional(), // Support nested objects, e.g. customHeaders
      ]),
    )
    .optional(),
});

export type UpdateAiProviderConfigParams = z.infer<typeof UpdateAiProviderConfigSchema>;

export interface AiProviderSortMap {
  id: string;
  sort: number;
}

// --------

export interface EnabledProvider {
  id: string;
  logo?: string;
  name?: string;
  source: AiProviderSourceType;
}

export interface EnabledProviderWithModels {
  children: AiModelForSelect[];
  id: string;
  logo?: string;
  name: string;
  source: AiProviderSourceType;
}

export interface AiProviderRuntimeConfig {
  config: AiProviderConfig;
  fetchOnClient?: boolean;
  keyVaults: Record<string, string>;
  settings: AiProviderSettings;
}

export interface AiProviderRuntimeState {
  enabledAiModels: EnabledAiModel[];
  enabledAiProviders: EnabledProvider[];
  enabledChatAiProviders: EnabledProvider[];
  enabledImageAiProviders: EnabledProvider[];
  runtimeConfig: Record<string, AiProviderRuntimeConfig>;
}
