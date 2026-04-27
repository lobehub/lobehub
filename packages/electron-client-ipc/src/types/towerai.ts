export interface TowerAICredentials {
  authToken: string;
  token: string;
}

export interface TowerAIAuthState {
  connected: boolean;
  expiresSoon: boolean;
  hasToken: boolean;
  lastRefreshAt?: string;
  loggedIn: boolean;
}

export interface TowerAILoginParams {
  baseUrl?: string;
  headless?: boolean;
  password: string;
  username: string;
}
