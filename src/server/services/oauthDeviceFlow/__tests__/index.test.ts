// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthDeviceFlowService } from '../index';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OAuthDeviceFlowService', () => {
  let service: OAuthDeviceFlowService;

  const mockConfig = {
    clientId: 'test-client-id',
    defaultPollingInterval: 5,
    deviceCodeEndpoint: 'https://example.com/device/code',
    scopes: ['read:user'],
    tokenEndpoint: 'https://example.com/oauth/token',
  };

  beforeEach(() => {
    service = new OAuthDeviceFlowService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initiateDeviceCode', () => {
    it('should successfully initiate device code flow', async () => {
      const mockResponse = {
        device_code: 'device-code-123',
        expires_in: 900,
        interval: 5,
        user_code: 'ABCD-1234',
        verification_uri: 'https://example.com/device',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
      });

      const result = await service.initiateDeviceCode(mockConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        mockConfig.deviceCodeEndpoint,
        expect.objectContaining({
          body: expect.stringContaining('client_id=test-client-id'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        }),
      );

      expect(result).toEqual({
        deviceCode: 'device-code-123',
        expiresIn: 900,
        interval: 5,
        userCode: 'ABCD-1234',
        verificationUri: 'https://example.com/device',
      });
    });

    it('should use verification_url if verification_uri is not present', async () => {
      const mockResponse = {
        device_code: 'device-code-123',
        expires_in: 900,
        interval: 5,
        user_code: 'ABCD-1234',
        verification_url: 'https://example.com/device-alt',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
      });

      const result = await service.initiateDeviceCode(mockConfig);

      expect(result.verificationUri).toBe('https://example.com/device-alt');
    });

    it('should use default polling interval if not provided', async () => {
      const mockResponse = {
        device_code: 'device-code-123',
        expires_in: 900,
        user_code: 'ABCD-1234',
        verification_uri: 'https://example.com/device',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
      });

      const result = await service.initiateDeviceCode(mockConfig);

      expect(result.interval).toBe(5);
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(service.initiateDeviceCode(mockConfig)).rejects.toThrow(
        'Failed to initiate device code: 400 Bad Request',
      );
    });
  });

  describe('pollForToken', () => {
    it('should return success status with tokens on successful authorization', async () => {
      const mockResponse = {
        access_token: 'access-token-123',
        expires_in: 3600,
        refresh_token: 'refresh-token-456',
        scope: 'read:user',
        token_type: 'bearer',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(mockFetch).toHaveBeenCalledWith(
        mockConfig.tokenEndpoint,
        expect.objectContaining({
          body: expect.stringContaining('device_code=device-code-123'),
          method: 'POST',
        }),
      );

      expect(result).toEqual({
        status: 'success',
        tokens: {
          accessToken: 'access-token-123',
          expiresIn: 3600,
          refreshToken: 'refresh-token-456',
          scope: 'read:user',
          tokenType: 'bearer',
        },
      });
    });

    it('should return pending status when authorization is pending', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'authorization_pending' }),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(result).toEqual({ status: 'pending' });
    });

    it('should return slow_down status', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'slow_down' }),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(result).toEqual({ status: 'slow_down' });
    });

    it('should return expired status when token expires', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'expired_token' }),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(result).toEqual({ status: 'expired' });
    });

    it('should return denied status when access is denied', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: 'access_denied' }),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(result).toEqual({ status: 'denied' });
    });

    it('should throw error for unknown OAuth error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: 'unknown_error',
            error_description: 'Something went wrong',
          }),
        ok: true,
      });

      await expect(service.pollForToken(mockConfig, 'device-code-123')).rejects.toThrow(
        'OAuth error: unknown_error - Something went wrong',
      );
    });

    it('should throw error when response has no access_token and no error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}),
        ok: true,
      });

      await expect(service.pollForToken(mockConfig, 'device-code-123')).rejects.toThrow(
        'Unexpected response from token endpoint',
      );
    });

    it('should use default token_type as bearer if not provided', async () => {
      const mockResponse = {
        access_token: 'access-token-123',
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
        ok: true,
      });

      const result = await service.pollForToken(mockConfig, 'device-code-123');

      expect(result.tokens?.tokenType).toBe('bearer');
    });
  });
});
