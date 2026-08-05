export interface OAuthAppItem {
  applicationType?: string | null;
  createdAt: Date;
  description?: string | null;
  enabled?: boolean | null;
  id: string;
  lastUsedAt?: Date | null;
  logoUri?: string | null;
  name: string;
  scopes?: string[] | null;
  updatedAt?: Date;
}

export interface CreateOAuthAppParams {
  description?: string;
  logoUri?: string;
  name: string;
}

export interface UpdateOAuthAppParams {
  description?: string;
  logoUri?: string;
  name?: string;
}
