import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { getUserIdFromApiKey } from './apiKey';
import type * as RefreshModule from './refresh';
import { getValidToken } from './refresh';
import { resolveToken } from './resolveToken';

vi.mock('./apiKey', () => ({
  getUserIdFromApiKey: vi.fn(),
}));
vi.mock('./refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue({ serverUrl: 'https://app.lobehub.com' }),
  resolveServerUrl: vi.fn(() =>
    (process.env.LOBEHUB_SERVER || 'https://app.lobehub.com').replace(/\/$/, ''),
  ),
}));
// Helper to create a valid JWT with sub claim
function makeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('resolveToken', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalApiKey = process.env.LOBEHUB_CLI_API_KEY;
  const originalJwt = process.env.LOBEHUB_JWT;
  const originalServer = process.env.LOBEHUB_SERVER;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    delete process.env.LOBEHUB_CLI_API_KEY;
    delete process.env.LOBEHUB_JWT;
    delete process.env.LOBEHUB_SERVER;
  });

  afterEach(() => {
    process.env.LOBEHUB_CLI_API_KEY = originalApiKey;
    process.env.LOBEHUB_JWT = originalJwt;
    process.env.LOBEHUB_SERVER = originalServer;
    exitSpy.mockRestore();
  });

  describe('with explicit --token', () => {
    it('should return token and userId from JWT', async () => {
      const token = makeJwt('user-123');

      const result = await resolveToken({ token });

      expect(result).toEqual({
        serverUrl: 'https://app.lobehub.com',
        token,
        tokenType: 'jwt',
        userId: 'user-123',
      });
    });

    it('should exit if JWT has no sub claim', async () => {
      const header = Buffer.from('{}').toString('base64url');
      const payload = Buffer.from('{}').toString('base64url');
      const token = `${header}.${payload}.sig`;

      await expect(resolveToken({ token })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit if JWT is malformed', async () => {
      await expect(resolveToken({ token: 'not-a-jwt' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('with --service-token', () => {
    it('should return token and userId', async () => {
      const result = await resolveToken({
        serviceToken: 'svc-token',
        userId: 'user-456',
      });

      expect(result).toEqual({
        serverUrl: 'https://app.lobehub.com',
        token: 'svc-token',
        tokenType: 'serviceToken',
        userId: 'user-456',
      });
    });

    it('should exit if --user-id is not provided', async () => {
      await expect(resolveToken({ serviceToken: 'svc-token' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('with environment api key', () => {
    it('should return API key from environment', async () => {
      process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-test';
      vi.mocked(getUserIdFromApiKey).mockResolvedValue('user-789');

      const result = await resolveToken({});

      expect(getUserIdFromApiKey).toHaveBeenCalledWith('sk-lh-test', 'https://app.lobehub.com');
      expect(result).toEqual({
        serverUrl: 'https://app.lobehub.com',
        token: 'sk-lh-test',
        tokenType: 'apiKey',
        userId: 'user-789',
      });
    });

    it('should prefer LOBEHUB_SERVER when validating the API key', async () => {
      process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-test';
      process.env.LOBEHUB_SERVER = 'https://self-hosted.example.com/';
      vi.mocked(getUserIdFromApiKey).mockResolvedValue('user-789');

      const result = await resolveToken({});

      expect(getUserIdFromApiKey).toHaveBeenCalledWith(
        'sk-lh-test',
        'https://self-hosted.example.com',
      );
      expect(result.serverUrl).toBe('https://self-hosted.example.com');
    });
  });

  describe('with stored credentials', () => {
    it('should return stored credentials token', async () => {
      const token = makeJwt('stored-user');
      vi.mocked(getValidToken).mockResolvedValue({
        credentials: {
          accessToken: token,
        },
        status: 'ok',
      });

      const result = await resolveToken({});

      expect(result).toEqual({
        serverUrl: 'https://app.lobehub.com',
        token,
        tokenType: 'jwt',
        userId: 'stored-user',
      });
    });

    it('should exit if stored token has no sub', async () => {
      const header = Buffer.from('{}').toString('base64url');
      const payload = Buffer.from('{}').toString('base64url');
      const token = `${header}.${payload}.sig`;

      vi.mocked(getValidToken).mockResolvedValue({
        credentials: {
          accessToken: token,
        },
        status: 'ok',
      });

      await expect(resolveToken({})).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when no stored credentials', async () => {
      vi.mocked(getValidToken).mockResolvedValue({ status: 'no-login' });

      await expect(resolveToken({})).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    /**
     * An unanswered refresh must not be dressed up as a missing login: the stored credentials are
     * still good, and telling the user to authenticate again is how a network blip turned into a
     * re-login.
     */
    it('should say the login survived when the refresh went unanswered', async () => {
      vi.mocked(getValidToken).mockResolvedValue({
        detail: 'fetch failed',
        status: 'unavailable',
      });
      const logError = vi.spyOn(log, 'error').mockImplementation(() => {});

      await expect(resolveToken({})).rejects.toThrow('process.exit');
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('Retry in a moment'));
      expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('No authentication found'));

      logError.mockRestore();
    });
  });
});
