import { type OAuthDeviceFlowConfig } from '@/types/aiProvider';

import { OAuthDeviceFlowService } from '../index';

export interface CopilotTokenResponse {
  expiresAt: number;
  token: string;
}

export interface GithubUserInfo {
  avatarUrl: string;
  username: string;
}

export interface GithubCopilotTokens {
  bearerToken: string;
  bearerTokenExpiresAt: number;
  oauthAccessToken: string;
  userInfo: GithubUserInfo;
}

export class GithubCopilotOAuthService extends OAuthDeviceFlowService {
  private static readonly GITHUB_USER_API = 'https://api.github.com/user';
  private static readonly TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token';

  /**
   * Fetch GitHub user info using OAuth access token
   */
  async fetchUserInfo(oauthToken: string): Promise<GithubUserInfo> {
    const response = await fetch(GithubCopilotOAuthService.GITHUB_USER_API, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `token ${oauthToken}`,
        'User-Agent': 'LobeChat/1.0',
      },
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub user info: ${response.status}`);
    }

    const data = await response.json();

    return {
      avatarUrl: data.avatar_url || '',
      username: data.login || '',
    };
  }

  /**
   * Exchange OAuth access token for GitHub Copilot bearer token
   */
  async exchangeForCopilotToken(oauthToken: string): Promise<CopilotTokenResponse> {
    const response = await fetch(GithubCopilotOAuthService.TOKEN_EXCHANGE_URL, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `token ${oauthToken}`,
        'User-Agent': 'LobeChat/1.0',
      },
      method: 'GET',
    });

    if (response.status === 401) {
      throw new Error('Invalid GitHub OAuth token');
    }

    if (response.status === 403) {
      throw new Error('No GitHub Copilot subscription or access denied');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exchange for Copilot token: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data?.token || typeof data.expires_at !== 'number') {
      throw new Error('Invalid Copilot token response format');
    }

    return {
      expiresAt: data.expires_at * 1000,
      token: data.token,
    };
  }

  /**
   * Complete the full OAuth flow for GitHub Copilot:
   * 1. Poll for OAuth token
   * 2. Exchange for Copilot bearer token
   * 3. Fetch GitHub user info
   */
  async completeAuthFlow(
    config: OAuthDeviceFlowConfig,
    deviceCode: string,
  ): Promise<GithubCopilotTokens | null> {
    const pollResult = await this.pollForToken(config, deviceCode);

    if (pollResult.status !== 'success' || !pollResult.tokens) {
      return null;
    }

    const oauthToken = pollResult.tokens.accessToken;
    const [copilotToken, userInfo] = await Promise.all([
      this.exchangeForCopilotToken(oauthToken),
      this.fetchUserInfo(oauthToken),
    ]);

    return {
      bearerToken: copilotToken.token,
      bearerTokenExpiresAt: copilotToken.expiresAt,
      oauthAccessToken: oauthToken,
      userInfo,
    };
  }

  /**
   * Refresh the Copilot bearer token using the existing OAuth token
   */
  async refreshCopilotToken(oauthToken: string): Promise<CopilotTokenResponse> {
    return this.exchangeForCopilotToken(oauthToken);
  }
}

/**
 * Factory function to get the appropriate OAuth service based on provider
 */
export function getOAuthService(providerId: string): OAuthDeviceFlowService {
  if (providerId === 'githubcopilot') {
    return new GithubCopilotOAuthService();
  }
  return new OAuthDeviceFlowService();
}
