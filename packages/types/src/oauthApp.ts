/** An OAuth app either talks to a browser redirect or polls a device code. */
export type OAuthAppType = 'device' | 'web';

export interface OAuthAppItem {
  applicationType?: string | null;
  createdAt: Date;
  description?: string | null;
  enabled?: boolean | null;
  grants?: string[] | null;
  /** Whether a client secret has been issued; the secret itself is never read back. */
  hasSecret?: boolean;
  id: string;
  lastUsedAt?: Date | null;
  logoUri?: string | null;
  name: string;
  redirectUris?: string[] | null;
  scopes?: string[] | null;
  updatedAt?: Date;
}

export interface CreateOAuthAppParams {
  description?: string;
  logoUri?: string;
  name: string;
  redirectUris?: string[];
  type?: OAuthAppType;
}

export interface UpdateOAuthAppParams {
  description?: string;
  logoUri?: string;
  name?: string;
  redirectUris?: string[];
}
