import type { ConnectorVisibility } from './apiKey';

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
  /**
   * Stdio / device-routed HTTP only: the device this connector always runs on,
   * through the device gateway. Absent means the device is picked automatically
   * (the run's device, else the newest capable personal one). A personal
   * connector binds one of its owner's personal devices, a workspace connector
   * a public device of its workspace. Never falls back: an offline bound device
   * fails the call (`connectorDeviceBinding` in `@lobechat/utils/mcpEndpoint`).
   */
  boundDeviceId?: string;
  /** Protocol capabilities learned when connector tools are synchronized. */
  capabilities?: { events?: { supported: boolean } };
  composio?: ComposioConnectorMetadata;
  /**
   * HTTP only: `device` reaches the MCP server from the user's device through
   * the device gateway, whatever its address looks like (Tailscale MagicDNS,
   * `.local`, intranet DNS). Absent means `auto`: decided by the address
   * (`shouldConnectViaDevice` in `@lobechat/utils/mcpEndpoint`).
   */
  connectVia?: 'device';
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
}

/** What inserting a `user_connectors` row takes; columns with a default are optional. */
export interface UserConnectorInsert {
  accessedAt?: Date;
  agentId?: string | null;
  createdAt?: Date;
  credentials?: string | null;
  id?: string;
  identifier: string;
  isEnabled?: boolean;
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
  mcpStdioConfig?: {
    args?: string[];
    command: string;
    env?: Record<string, string>;
  } | null;
  metadata?: ConnectorMetadata | null;
  name: string;
  oidcConfig?: ConnectorOIDCConfig | null;
  sourceType: string;
  status: string;
  tokenExpiresAt?: Date | null;
  updatedAt?: Date;
  userId: string;
  visibility?: ConnectorVisibility;
  workspaceId?: string | null;
}

/**
 * Connector fields a legacy-plugin migration may write. Ownership, primary key
 * and creation/update timestamps are server-owned and intentionally absent.
 */
export type UserConnectorMigrationPayload = Omit<
  UserConnectorInsert,
  'createdAt' | 'id' | 'updatedAt' | 'userId'
>;

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
      /** Persisted before submitting a refresh. An abandoned attempt requires reauthorization. */
      refreshState?:
        | { id: string; status: 'complete' }
        | { deadline: number; id: string; status: 'pending' }
        | { status: 'reconnect_required' };
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

export const needsConnectorReauthorization = (credentials: ConnectorCredentials | null) =>
  credentials?.type === 'oauth2' && credentials.refreshState?.status === 'reconnect_required';

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
