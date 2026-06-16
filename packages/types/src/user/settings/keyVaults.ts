export interface OpenAICompatibleKeyVault {
  apiKey?: string;
  baseURL?: string;
  /**
   * Authentication method for Anthropic-compatible providers.
   * - 'apiKey': sends API key as x-api-key header (Anthropic default)
   * - 'authToken': sends API key as Authorization: Bearer header
   * @default 'apiKey'
   */
  authMethod?: 'apiKey' | 'authToken';
}

export interface FalKeyVault {
  apiKey?: string;
}

export interface AzureOpenAIKeyVault {
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
  /**
   * @deprecated
   */
  endpoint?: string;
}

export interface AWSBedrockKeyVault {
  accessKeyId?: string;
  apiKey?: string;
  region?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface VertexAIKeyVault {
  apiKey?: string;
  region?: string;
}

export interface CloudflareKeyVault {
  apiKey?: string;
  baseURLOrAccountID?: string;
}

export interface ComfyUIKeyVault {
  apiKey?: string;
  authType?: 'none' | 'basic' | 'bearer' | 'custom';
  baseURL?: string;
  customHeaders?: Record<string, string>;
  password?: string;
  username?: string;
}

export interface GithubCopilotKeyVault {
  /**
   * Traditional PAT (Personal Access Token)
   */
  apiKey?: string;
  /**
   * Provider-specific bearer token (Copilot API token)
   */
  bearerToken?: string;
  /**
   * Bearer token expiration timestamp (ms)
   */
  bearerTokenExpiresAt?: string;
  /**
   * OAuth access token (e.g., GitHub's ghu_xxx)
   */
  oauthAccessToken?: string;
}

export interface SuperGrokKeyVault {
  /**
   * xAI OAuth access token (JWT, ~1h lifetime)
   */
  oauthAccessToken?: string;
  /**
   * xAI OAuth refresh token. Rotates on every refresh — single use.
   */
  oauthRefreshToken?: string;
  /**
   * Access token expiration timestamp (ms)
   */
  oauthTokenExpiresAt?: string;
}

export interface SearchEngineKeyVaults {
  searchxng?: {
    apiKey?: string;
    baseURL?: string;
  };
}

export interface UserKeyVaults extends SearchEngineKeyVaults {
  search1api?: OpenAICompatibleKeyVault;
}
