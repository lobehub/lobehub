/**
 * OIDC / OAuth client configuration of a connector (`user_connectors.oidc_config`).
 * Plaintext and non-sensitive: access / refresh tokens live encrypted in the
 * row's `credentials` instead.
 */
export interface ConnectorOidcConfig {
  authorizationEndpoint?: string;

  /**
   * Client identifier.
   * - pre_registration: filled in by the user
   * - dcr: written back after dynamic registration succeeds
   * - client_id_metadata_document: this value IS the metadata URL
   */
  clientId?: string;

  /**
   * Client secret for confidential clients.
   * - pre_registration: filled in by the user
   * - dcr: written back after dynamic registration succeeds
   * Stored in plaintext (non-token credential); access/refresh tokens live
   * encrypted in `credentials` instead.
   */
  clientSecret?: string;

  /** OIDC discovery issuer URL — preferred over manual endpoint overrides */
  issuer?: string;
  redirectUri?: string;
  /** DCR only (RFC 7591) — dynamic client registration endpoint */
  registrationEndpoint?: string;

  scheme: 'pre_registration' | 'dcr' | 'client_id_metadata_document';
  scopes?: string[];
  tokenEndpoint?: string;

  /**
   * How the client authenticates at the token endpoint. DCR records the method
   * the server registered; otherwise it is learned from the first successful
   * exchange. Servers that enforce the registered method reject any other one.
   */
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';

  /** Recommended for public clients */
  usePKCE?: boolean;
}

/**
 * The `user_connectors` row a call resolved to: its id plus the owner and the
 * workspace it lives in (`null` for a personal row). Writes that follow the call,
 * such as connection health, go through this row's own scope.
 */
export interface ResolvedConnectorRef {
  id: string;
  userId: string;
  workspaceId: string | null;
}
