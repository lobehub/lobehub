// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthDeviceFlowService } from '../../index';
import { getOAuthService,GithubCopilotOAuthService } from '../../providers/githubCopilot';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GithubCopilotOAuthService', () => {
  let service: GithubCopilotOAuthService;

  const mockConfig = {
    clientId: 'Iv1.b507a08c87ecfe98',
    defaultPollingInterval: 5,
    deviceCodeEndpoint: 'https://github.com/login/device/code',
    scopes: ['read:user'],
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    tokenExchangeEndpoint: 'https://api.github.com/copilot_internal/v2/token',
  };

  beforeEach(() => {
    service = new GithubCopilotOAuthService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('exchangeForCopilotToken', () => {
    it('should successfully exchange OAuth token for Copilot token', async () => {
      const mockResponse = {
        expires_at: 1700000000,
        token: 'copilot-bearer-token-123',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
        status: 200,
      });

      const result = await service.exchangeForCopilotToken('oauth-token-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/copilot_internal/v2/token',
        expect.objectContaining({
          headers: {
            'Accept': 'application/json',
            'Authorization': 'token oauth-token-123',
            'User-Agent': 'LobeChat/1.0',
          },
          method: 'GET',
        }),
      );

      expect(result).toEqual({
        expiresAt: 1700000000 * 1000,
        token: 'copilot-bearer-token-123',
      });
    });

    it('should throw error for invalid OAuth token (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(service.exchangeForCopilotToken('invalid-token')).rejects.toThrow(
        'Invalid GitHub OAuth token',
      );
    });

    it('should throw error for no Copilot subscription (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(service.exchangeForCopilotToken('oauth-token')).rejects.toThrow(
        'No GitHub Copilot subscription or access denied',
      );
    });

    it('should throw error for other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(service.exchangeForCopilotToken('oauth-token')).rejects.toThrow(
        'Failed to exchange for Copilot token: 500 Internal Server Error',
      );
    });

    it('should throw error for invalid response format', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ invalid: 'response' }),
        ok: true,
        status: 200,
      });

      await expect(service.exchangeForCopilotToken('oauth-token')).rejects.toThrow(
        'Invalid Copilot token response format',
      );
    });

    it('should throw error if expires_at is not a number', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ expires_at: 'not-a-number', token: 'token' }),
        ok: true,
        status: 200,
      });

      await expect(service.exchangeForCopilotToken('oauth-token')).rejects.toThrow(
        'Invalid Copilot token response format',
      );
    });
  });

  describe('completeAuthFlow', () => {
    it('should complete full auth flow successfully', async () => {
      // Mock pollForToken response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            access_token: 'oauth-access-token-123',
            token_type: 'bearer',
          }),
        ok: true,
      });

      // Mock exchangeForCopilotToken response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            expires_at: 1700000000,
            token: 'copilot-bearer-token-123',
          }),
        ok: true,
        status: 200,
      });

      // Mock fetchUserInfo response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            avatar_url: 'https://avatars.githubusercontent.com/u/123',
            login: 'testuser',
          }),
        ok: true,
        status: 200,
      });

      const result = await service.completeAuthFlow(mockConfig, 'device-code-123');

      expect(result).toEqual({
        bearerToken: 'copilot-bearer-token-123',
        bearerTokenExpiresAt: 1700000000 * 1000,
        oauthAccessToken: 'oauth-access-token-123',
        userInfo: {
          avatarUrl: 'https://avatars.githubusercontent.com/u/123',
          username: 'testuser',
        },
      });
    });

    it('should return null when poll returns pending status', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'authorization_pending' }),
        ok: true,
      });

      const result = await service.completeAuthFlow(mockConfig, 'device-code-123');

      expect(result).toBeNull();
    });

    it('should return null when poll returns expired status', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'expired_token' }),
        ok: true,
      });

      const result = await service.completeAuthFlow(mockConfig, 'device-code-123');

      expect(result).toBeNull();
    });

    it('should return null when poll returns denied status', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'access_denied' }),
        ok: true,
      });

      const result = await service.completeAuthFlow(mockConfig, 'device-code-123');

      expect(result).toBeNull();
    });
  });

  describe('refreshCopilotToken', () => {
    it('should refresh Copilot token using existing OAuth token', async () => {
      const mockResponse = {
        expires_at: 1700000000,
        token: 'new-copilot-bearer-token',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
        status: 200,
      });

      const result = await service.refreshCopilotToken('oauth-token-123');

      expect(result).toEqual({
        expiresAt: 1700000000 * 1000,
        token: 'new-copilot-bearer-token',
      });
    });
  });
});

describe('getOAuthService', () => {
  it('should return GithubCopilotOAuthService for githubcopilot provider', () => {
    const service = getOAuthService('githubcopilot');
    expect(service).toBeInstanceOf(GithubCopilotOAuthService);
  });

  it('should return base OAuthDeviceFlowService for other providers', () => {
    const service = getOAuthService('other-provider');
    expect(service).toBeInstanceOf(OAuthDeviceFlowService);
    expect(service).not.toBeInstanceOf(GithubCopilotOAuthService);
  });
});
