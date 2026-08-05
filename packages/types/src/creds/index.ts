/**
 * Credential Types for Market SDK Integration
 */

// ===== Credential Type =====

export type CredType = 'kv-env' | 'kv-header' | 'oauth' | 'file';

// ===== Credential Summary (for list display) =====

export interface UserCredSummary {
  createdAt: string;
  description?: string;
  // File type specific
  fileName?: string;
  fileSize?: number;
  id: number;
  key: string;
  lastUsedAt?: string;
  maskedPreview?: string; // Masked preview, e.g., "sk-****xxxx"
  name: string;
  // OAuth type specific
  oauthAvatar?: string;
  oauthProvider?: string;
  oauthUsername?: string;
  /**
   * Account id of the organization this credential is linked to. Present
   * once linked via `share`, regardless of whether `visibility` has been
   * flipped to 'public' yet (see `sharedAt`).
   */
  organizationAccountId?: number;
  /**
   * Owner account id of this credential, only populated in organization-scoped
   * list/get responses (`workspaceCreds.list` / `workspaceCreds.get`).
   */
  ownerAccountId?: number;
  /** See `ownerAccountId`. */
  ownerDisplayName?: string;
  /** See `ownerAccountId`. */
  ownerNamespace?: string;
  /**
   * 'organization' when the organization created this credential directly;
   * 'user' when a member shared their own personal credential in. Only
   * populated in organization-scoped list/get responses.
   */
  ownerType?: 'organization' | 'user';
  /**
   * Timestamp when `visibility` last became 'public'. Unset while only
   * draft-linked (`organizationAccountId` set, `visibility` still 'private').
   */
  sharedAt?: string;
  /**
   * Cloud-computed enrichment on personal-scoped list responses only
   * (`market.creds.list`, when called with an active workspace context):
   * whether `organizationAccountId` actually points at the *current* active
   * workspace's organization, as opposed to some other workspace the
   * credential was previously shared to. A personal credential can only be
   * linked to one organization at a time, so `organizationAccountId != null`
   * alone can't distinguish "shared here" from "shared elsewhere" — always
   * prefer this field over `organizationAccountId` for workspace-scoped UI.
   * Absent entirely outside a workspace context.
   */
  sharedToActiveWorkspace?: boolean;
  type: CredType;
  updatedAt: string;
  /**
   * 'private' (default, only the owning account can see/use it) or 'public'
   * (shared with organizationAccountId's members).
   */
  visibility?: 'private' | 'public';
}

// ===== Credential with Plaintext (for editing) =====

export interface CredWithPlaintext extends UserCredSummary {
  plaintext?: Record<string, string>; // Decrypted key-value pairs for KV types
}

// ===== Create Request Types =====

export interface CreateKVCredRequest {
  description?: string;
  key: string;
  name: string;
  type: 'kv-env' | 'kv-header';
  values: Record<string, string>;
}

export interface CreateOAuthCredRequest {
  description?: string;
  key: string;
  name: string;
  oauthConnectionId: number;
}

export interface CreateFileCredRequest {
  description?: string;
  fileHashId: string;
  fileName: string;
  key: string;
  name: string;
}

// ===== Update Request =====

export interface UpdateCredRequest {
  description?: string;
  name?: string;
  values?: Record<string, string>; // Only for KV types
}

// ===== Share Request =====

/**
 * Shares one of the caller's own personal credentials into a workspace's
 * Market organization. Defaults to `visibility: 'public'` (immediately
 * visible to the org); pass `'private'` to only link it as a draft.
 */
export interface ShareCredRequest {
  visibility?: 'private' | 'public';
}

// ===== Get Options =====

export interface GetCredOptions {
  decrypt?: boolean;
}

// ===== List Response =====

export interface ListCredsResponse {
  data: UserCredSummary[];
}

// ===== Delete Response =====

export interface DeleteCredResponse {
  success: boolean;
}

// ===== Skill Credential Status =====

export interface SkillCredStatus {
  boundCred?: UserCredSummary;
  description?: string;
  key: string;
  name: string;
  required: boolean;
  satisfied: boolean;
  type: CredType;
}

// ===== Inject Request/Response =====

export interface InjectCredsRequest {
  sandbox?: boolean;
  skillIdentifier: string;
}

export interface InjectCredsResponse {
  credentials: {
    env: Record<string, string>;
    files: Array<{
      content: string; // S3 URL
      envName?: string;
      fileName: string;
      key: string;
      mimeType: string;
    }>;
    headers: Record<string, string>;
  };
  missing: Array<{
    key: string;
    name: string;
    type: CredType;
  }>;
  success: boolean;
  unsupportedInSandbox: string[];
}

// ===== OAuth Connection (for creating OAuth creds) =====

export interface OAuthConnection {
  avatar?: string;
  id: number;
  providerId: string;
  providerName?: string;
  username?: string;
}
