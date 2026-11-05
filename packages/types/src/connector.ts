export interface OIDCConfig {
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
 * Decrypted shape of the `credentials` column.
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

/**
 * Composio runtime config carried on `user_connectors.metadata.composio`.
 *
 * This is the source of truth for running a Composio connector at runtime
 * (manifest building + tool execution), replacing the reverse lookup into
 * `user_installed_plugins.customParams.composio`. `connectedAccountId` is the
 * only field strictly required to execute a tool; the rest support connection
 * management and list display.
 */
export interface ComposioConnectorMetadata {
  appSlug: string;
  authConfigId: string;
  connectedAccountId: string;
  /**
   * The user entity that LINKED this connected account
   * (`connectedAccounts.link(linkedByUserId, …)`). This is the Composio entity
   * the account is bound to and MUST be passed as `userId` when executing tools —
   * NOT the caller (a workspace member runs another user's connector) and NOT the
   * row creator (`user_connectors.userId`), which can diverge when a workspace
   * owner reconnects a member-created connector. Absent on rows created before
   * this field existed; runtime falls back to the row creator for those.
   */
  linkedByUserId?: string;
  redirectUrl?: string;
  /** 'PENDING' | 'ACTIVE' | 'FAILED' — Composio-side connection status */
  status: string;
}

/**
 * Typed shape of the `metadata` column. Keeps an index signature so existing
 * ad-hoc keys (e.g. `customHeaders`) and future extensions stay valid.
 */
export interface ConnectorMetadata {
  [key: string]: unknown;
  avatar?: string;
  composio?: ComposioConnectorMetadata;
  customHeaders?: Record<string, string>;
  description?: string;
  /**
   * "Mount" reference lock: a base (user-owned) connector referenced by an
   * agent via the "挂载/Linked" flow. The row stays user-owned (`agent_id`
   * NULL) and keeps syncing with the user's edits, but resolves for this agent
   * and is locked so no other agent can mount the same connector. Cleared on
   * unmount. Distinct from `agent_id` (which is full agent ownership — Copy /
   * Connect-new).
   */
  mountedByAgentId?: string;
  /** Confirm-first access for connections managed by native personal-agent clients. */
  nativeAccess?: {
    /** Empty until the user confirms; never interpreted as unrestricted. */
    agentIds: string[];
    /** Explicit, server-reviewed read operations, never an inferred name prefix. */
    readToolNames: string[];
    /** Concrete Composio versions verified when tools were synchronized. */
    readToolVersions?: Record<string, string>;
    revision?: number;
  };
}

export interface UserConnectorItem {
  accessedAt: Date;
  agentId: string | null;
  createdAt: Date;
  credentials: string | null;
  id: string;
  identifier: string;
  isEnabled: boolean;
  mcpConnectionType: string | null;
  mcpServerUrl: string | null;
  mcpStdioConfig: { args?: string[]; command: string; env?: Record<string, string> } | null;
  metadata: ConnectorMetadata | null;
  name: string;
  oidcConfig: OIDCConfig | null;
  sourceType: string;
  status: string;
  tokenExpiresAt: Date | null;
  updatedAt: Date;
  userId: string;
  workspaceId: string | null;
}

export interface NewUserConnector extends Partial<UserConnectorItem> {
  identifier: string;
  name: string;
  sourceType: string;
  status: string;
  userId: string;
}
