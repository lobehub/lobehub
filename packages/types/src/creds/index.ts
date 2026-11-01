/**
 * Credential Types for Market SDK Integration
 */

// ===== Credential Type =====

export type CredType = 'kv-env' | 'kv-header' | 'oauth' | 'file';

// ===== Credential Summary (for list display) =====

/** One workspace organization a personal credential is shared into. */
export interface CredShareSummary {
  organizationAccountId: number;
  /** Set while `visibility` is 'public': when it was last published. */
  sharedAt?: string;
  /**
   * 'private': linked for the owner's own use in that workspace only.
   * 'public': usable by every member of that workspace.
   */
  visibility: 'private' | 'public';
  /** Cloud workspace the organization mirrors, when it mirrors one. */
  workspaceId?: string;
}

export interface UserCredSummary {
  createdAt: string;
  /**
   * Market account of the member who created a workspace-owned credential.
   * Unset on personal credentials and on workspace credentials created
   * before creators were recorded (those are admin-managed).
   */
  createdByAccountId?: number;
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
   * Organization-scoped responses only: the organization the credential is
   * being viewed in.
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
   * Organization-scoped responses, member-shared credentials only: when the
   * share was last published.
   */
  sharedAt?: string;
  /**
   * Personal responses only: whether the credential is shared into the
   * active workspace (derived from `shares`). Absent outside a workspace
   * context.
   */
  sharedToActiveWorkspace?: boolean;
  /** Personal responses only: the workspaces this credential is shared into. */
  shares?: CredShareSummary[];
  type: CredType;
  updatedAt: string;
  /**
   * Organization-scoped responses only. 'private': only its creator (a
   * workspace credential) or its owner (a shared personal credential) can
   * use it in this workspace. 'public': every member can.
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
