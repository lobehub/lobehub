export interface TowerAITokenState {
  authToken: string;
  lastRefreshAt?: string;
  token: string;
}

export interface TowerAIAuthState {
  connected: boolean;
  expiresSoon: boolean;
  hasToken: boolean;
  lastRefreshAt?: string;
  loggedIn: boolean;
}

class TowerAIStore {
  private state: TowerAITokenState = { authToken: '', token: '' };

  get(): TowerAITokenState {
    return { ...this.state };
  }

  set(state: TowerAITokenState): void {
    this.state = { ...state, lastRefreshAt: new Date().toISOString() };
  }

  clear(): void {
    this.state = { authToken: '', token: '' };
  }

  getAuthState(): TowerAIAuthState {
    return {
      connected: true,
      expiresSoon: false,
      hasToken: Boolean(this.state.token),
      lastRefreshAt: this.state.lastRefreshAt,
      loggedIn: Boolean(this.state.token),
    };
  }
}

export const towerAIStore = new TowerAIStore();
