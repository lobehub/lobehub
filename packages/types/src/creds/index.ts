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
  type: CredType;
  updatedAt: string;
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
