import type { CredType } from '@lobechat/types';

export const CredsApiName = {
  /**
   * Connect a Klavis integration service via OAuth
   * Initiates Klavis OAuth flow for third-party services like Notion, Gmail, etc.
   */
  connectKlavisService: 'connectKlavisService',

  /**
   * Get plaintext value of a credential
   * Use when AI needs to access credential value for API calls
   */
  getPlaintextCred: 'getPlaintextCred',

  /**
   * Initiate OAuth connection flow
   * Returns authorization URL for user to click and authorize
   */
  initiateOAuthConnect: 'initiateOAuthConnect',

  /**
   * Inject credentials to sandbox environment
   * Only available when sandbox mode is enabled
   */
  injectCredsToSandbox: 'injectCredsToSandbox',

  /**
   * Save a new credential
   * Use when user wants to store sensitive info securely
   */
  saveCreds: 'saveCreds',
} as const;

export type CredsApiNameType = (typeof CredsApiName)[keyof typeof CredsApiName];

// ==================== Tool Parameter Types ====================

export interface GetPlaintextCredParams {
  /**
   * The unique key of the credential to retrieve
   */
  key: string;
  /**
   * Reason for accessing this credential (for audit purposes)
   */
  reason?: string;
}

export interface InitiateOAuthConnectParams {
  /**
   * The OAuth provider ID (e.g., 'linear', 'microsoft', 'twitter')
   */
  provider: string;
}

export interface InitiateOAuthConnectState {
  /**
   * The OAuth authorization URL for the user to click
   */
  authorizeUrl: string;
  /**
   * Authorization code (for tracking)
   */
  code?: string;
  /**
   * Expiration time in seconds
   */
  expiresIn?: number;
  /**
   * Provider display name
   */
  providerName: string;
}

export interface GetPlaintextCredState {
  /**
   * The credential key
   */
  key: string;
  /**
   * The plaintext values (key-value pairs)
   */
  values?: Record<string, string>;
}

export interface InjectCredsToSandboxParams {
  /**
   * The credential keys to inject
   */
  keys: string[];
}

export interface InjectCredsToSandboxState {
  /**
   * Injected credential keys
   */
  injected: string[];
  /**
   * Keys that failed to inject (not found or not available)
   */
  missing: string[];
  /**
   * Whether injection was successful
   */
  success: boolean;
}

export interface SaveCredsParams {
  /**
   * Optional description for the credential
   */
  description?: string;
  /**
   * Unique key for the credential (used for reference)
   */
  key: string;
  /**
   * Display name for the credential
   */
  name: string;
  /**
   * The type of credential
   */
  type: CredType;
  /**
   * Key-value pairs of the credential (for kv-env and kv-header types)
   */
  values: Record<string, string>;
}

export interface SaveCredsState {
  /**
   * The created credential key
   */
  key?: string;
  /**
   * Error message if save failed
   */
  message?: string;
  /**
   * Whether save was successful
   */
  success: boolean;
}

// ==================== Klavis Service Types ====================

export interface ConnectKlavisServiceParams {
  /**
   * The Klavis service identifier to connect (e.g., 'notion', 'gmail', 'google-calendar')
   */
  service: string;
}

export interface ConnectKlavisServiceState {
  /**
   * Whether the service is now connected
   */
  connected: boolean;
  /**
   * The service identifier
   */
  identifier: string;
  /**
   * OAuth URL (only present when authorization is needed)
   */
  oauthUrl?: string;
  /**
   * The service display name
   */
  serviceName: string;
}

// ==================== Context Types ====================

export interface CredSummaryForContext {
  description?: string;
  key: string;
  name: string;
  type: CredType;
}
