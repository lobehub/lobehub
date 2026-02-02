/**
 * RFC 9728 protected resource metadata (/.well-known/oauth-protected-resource)
 */
export interface OAuthProtectedResourceMetadata {
  authorization_servers?: string[];
  resource?: string;
  resource_name?: string;
}

/**
 * RFC 8414 authorization server metadata (/.well-known/oauth-authorization-server)
 */
export interface OAuthAuthorizationServerMetadata {
  [key: string]: unknown;
  authorization_endpoint: string;
  registration_endpoint?: string;
  token_endpoint: string;
}

export interface McpOAuthDiscoverResult {
  requiresOAuth: false;
}

export interface McpOAuthDiscoverResultOAuth {
  authorization_servers: string[];
  providerName?: string;
  requiresOAuth: true;
  serverMetadata: OAuthAuthorizationServerMetadata;
}

export type McpOAuthDiscoverResultType = McpOAuthDiscoverResult | McpOAuthDiscoverResultOAuth;

export interface DynamicRegistrationPayload {
  [key: string]: unknown;
  client_name?: string;
  grant_types?: string[];
  redirect_uris: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

export interface DynamicRegistrationResponse {
  [key: string]: unknown;
  client_id: string;
  client_secret?: string;
}

export interface TokenResponse {
  [key: string]: unknown;
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
}
