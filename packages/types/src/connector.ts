export type ConnectorLinkStatus = 'connected' | 'error';
export type ConnectorAuthKind = 'oauth2' | 'bearer' | 'apikey' | 'header' | 'none';

export interface ConnectorLinkProfile {
  avatar?: string;
  email?: string;
  name?: string;
  username?: string;
}

/** OAuth/OIDC client configuration of a connector (`user_connectors.oidc_config`). */
export interface ConnectorOIDCConfig {
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
 * Decrypted shape of a connector's `credentials` column, except for a connector
 * holding OAuth accounts ({@link ConnectorOAuthAccounts}). A single `oauth2`
 * value is the slot written before accounts existed; it reads as one account.
 * Encrypted at rest via KeyVaultsGateKeeper (same as messengerInstallations).
 */
export type ConnectorCredentials =
  | {
      type: 'oauth2';
      accessToken: string;
      refreshToken?: string;
      clientSecret?: string;
      /** DCR — token for managing the dynamic registration */
      registrationAccessToken?: string;
      expiresAt?: number;
      scope?: string;
      idToken?: string;
    }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; apiKey: string }
  | { type: 'header'; headers: Record<string, string> };

export type ConnectorOAuthCredentials = Extract<ConnectorCredentials, { type: 'oauth2' }>;

/** One OAuth account connected to a connector, stored in {@link ConnectorOAuthAccounts}. */
export interface ConnectorLinkRecord {
  /** Epoch ms; accounts are listed in this order. */
  createdAt: number;
  /** `id_token` is transient identity input and never stored. */
  credentials: Omit<ConnectorOAuthCredentials, 'idToken'>;
  /** Provider identity used to recognise the same account again. */
  externalAccountId?: string;
  /** `lnk_…`, unique within the connector; the `link_id` the model selects an account with. */
  id: string;
  /** Stored display name, unique within the connector. */
  name: string;
  profile?: ConnectorLinkProfile;
  status: ConnectorLinkStatus;
  /** The member who authorized this account. */
  userId: string;
}

/**
 * Decrypted `credentials` of a connector holding OAuth accounts: all of them,
 * encrypted together on the connector row. `type` stays `oauth2` so code that
 * strips OAuth tokens before returning a connector's credentials (and code of
 * an earlier release) strips these too.
 */
export interface ConnectorOAuthAccounts {
  accounts: ConnectorLinkRecord[];
  type: 'oauth2';
}
