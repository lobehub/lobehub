export interface MarketUserInfo {
  accountId: number;
  clientId: string;
  grantId: string;
  scopes: string[];
  sub: string;
  tokenData: {
    accountId: string;
    clientId: string;
    exp: number;
    expiresWithSession: boolean;
    grantId: string;
    gty: string;
    iat: number;
    jti: string;
    kind: string;
    scope: string;
    sessionUid: string;
  };
}

/**
 * Market User Profile - Extended user information from Market SDK
 */
export interface MarketUserProfile {
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
  description: string | null;
  displayName: string | null;
  id: number;
  namespace: string;
  socialLinks: {
    github?: string;
    twitter?: string;
    website?: string;
  } | null;
  type: string | null;
  userName: string | null;
}

export interface MarketAuthSession {
  accessToken: string;
  expiresAt: number;
  expiresIn: number;
  scope: string;
  tokenType: 'Bearer';
  userInfo?: MarketUserInfo;
}

export interface MarketAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: MarketAuthSession | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

export interface MarketAuthContextType extends MarketAuthState {
  getAccessToken: () => string | null;
  getCurrentUserInfo: () => MarketUserInfo | null;
  getRefreshToken: () => string | null;
  openProfileSetup: (onSuccess?: (profile: MarketUserProfile) => void) => void;
  refreshToken: () => Promise<boolean>;
  signIn: () => Promise<number | null>;
  signOut: () => Promise<void>;
}

export interface OIDCConfig {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface PKCEParams {
  codeChallenge: string;
  codeVerifier: string;
  state: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  idToken?: string;
  refreshToken?: string;
  scope: string;
  tokenType: string;
}
