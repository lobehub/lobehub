// API Key database item type (independent from schema)
export interface ApiKeyItem {
  accessedAt: Date;
  createdAt: Date;
  enabled?: boolean | null;
  expiresAt?: Date | null;
  id: string;
  key: string;
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
