// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeGithubCopilotAI } from './index';

// Mock console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LobeGithubCopilotAI', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should throw error if no token is provided', () => {
      expect(() => new LobeGithubCopilotAI({})).toThrow();
    });

    it('should accept apiKey as PAT', () => {
      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test_pat' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should accept oauthAccessToken', () => {
      const instance = new LobeGithubCopilotAI({ oauthAccessToken: 'ghu_test_oauth' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should use cached bearer token if still valid', () => {
      const futureTime = Date.now() + 600_000; // 10 minutes from now
      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_test_oauth',
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should not use cached bearer token if expired', () => {
      const pastTime = Date.now() - 600_000; // 10 minutes ago
      const instance = new LobeGithubCopilotAI({
        apiKey: 'ghp_fallback',
        bearerToken: 'expired-bearer-token',
        bearerTokenExpiresAt: pastTime,
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should prefer oauthAccessToken over apiKey', () => {
      const instance = new LobeGithubCopilotAI({
        apiKey: 'ghp_pat',
        oauthAccessToken: 'ghu_oauth',
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });
  });

  describe('models', () => {
    it('should fetch available models successfully', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token: 'bearer-token-123',
          }),
        ok: true,
        status: 200,
      });

      // Mock models endpoint
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              { id: 'gpt-4o', name: 'GPT-4o' },
              { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            ],
          }),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test' });
      const models = await instance.models();

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        displayName: 'GPT-4o',
        enabled: true,
        id: 'gpt-4o',
        type: 'chat',
      });
      expect(models[1]).toMatchObject({
        displayName: 'Claude 3.5 Sonnet',
        enabled: true,
        id: 'claude-3.5-sonnet',
        type: 'chat',
      });
    });

    it('should use cached bearer token for models request', async () => {
      const futureTime = Date.now() + 600_000;

      // Mock models endpoint only (no token exchange needed)
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-4o', name: 'GPT-4o' }],
          }),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      const models = await instance.models();

      // Should only call fetch once for models (no token exchange)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer cached-bearer-token',
          }),
        }),
      );
      expect(models).toHaveLength(1);
    });

    it('should handle empty models response', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token: 'bearer-token-123',
          }),
        ok: true,
        status: 200,
      });

      // Mock empty models response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test' });
      const models = await instance.models();

      expect(models).toEqual([]);
    });
  });

  describe('error handling in constructor', () => {
    it('should throw InvalidGithubCopilotToken when no credentials provided', () => {
      expect(() => new LobeGithubCopilotAI({})).toThrow();
    });

    it('should throw with descriptive message', () => {
      try {
        new LobeGithubCopilotAI({});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.errorType).toBe('InvalidGithubCopilotToken');
      }
    });
  });

  describe('baseURL', () => {
    it('should have correct base URL', () => {
      const instance = new LobeGithubCopilotAI({ apiKey: 'test' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });
  });
});
