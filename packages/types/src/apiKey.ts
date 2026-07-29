// API Key database item type (independent from schema)
export interface ApiKeyItem {
  accessedAt: Date;
  createdAt: Date;
  // Display name of the key's creator (workspace list view); null when unknown.
  creator?: string | null;
  enabled?: boolean | null;
  expiresAt?: Date | null;
  id: string;
  // Whether the current caller created this key. Only own keys carry the
  // decrypted plaintext `key`; other members' rows come back masked.
  isMine?: boolean;
  key: string;
  // A stale encrypted value must not make the whole list fail. When true,
  // callers can still manage or rotate the row but cannot reveal its secret.
  keyDecryptionFailed?: boolean;
  lastUsedAt?: Date | null;
  name: string;
  updatedAt: Date;
  userId: string;
}

export interface CreateApiKeyParams {
  expiresAt?: Date | null;
  name: string;
}

export interface UpdateApiKeyParams {
  enabled?: boolean;
  expiresAt?: Date | null;
  name?: string;
}
