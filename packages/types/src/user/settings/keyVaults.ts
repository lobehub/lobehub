export interface OpenAICompatibleKeyVault {
  apiKey?: string;
  baseURL?: string;
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

/**
 * Doubao Speech (Volcengine speech synthesis): an API key from the new speech console, or
 * the legacy console's App ID + Access Token.
 */
export interface DoubaoSpeechKeyVault {
  /** Legacy console Access Token, sent as `X-Api-Access-Key` with `appId`. */
  accessToken?: string;
  /** New-console API key, sent as `X-Api-Key`. */
  apiKey?: string;
  /** Legacy console App ID, sent as `X-Api-App-Id` with `accessToken`. */
  appId?: string;
  baseURL?: string;
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
