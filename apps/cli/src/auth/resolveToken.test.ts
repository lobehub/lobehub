import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getValidToken } from './refresh';
import { resolveToken } from './resolveToken';

vi.mock('./refresh', () => ({
  getValidToken: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Helper to create a valid JWT with sub claim
function makeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('resolveToken', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('with explicit --token', () => {
    it('should return token and userId from JWT', async () => {
      const token = makeJwt('user-123');

      const result = await resolveToken({ token });

      expect(result).toEqual({ token, userId: 'user-123' });
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

      expect(result).toEqual({ token: 'svc-token', userId: 'user-456' });
    });

    it('should exit if --user-id is not provided', async () => {
      await expect(resolveToken({ serviceToken: 'svc-token' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('with stored credentials', () => {
    it('should return stored credentials token', async () => {
      const token = makeJwt('stored-user');
      vi.mocked(getValidToken).mockResolvedValue({
        credentials: {
          accessToken: token,
          serverUrl: 'https://app.lobehub.com',
        },
      });

      const result = await resolveToken({});

      expect(result).toEqual({ token, userId: 'stored-user' });
    });

    it('should exit if stored token has no sub', async () => {
      const header = Buffer.from('{}').toString('base64url');
      const payload = Buffer.from('{}').toString('base64url');
      const token = `${header}.${payload}.sig`;

      vi.mocked(getValidToken).mockResolvedValue({
        credentials: {
          accessToken: token,
          serverUrl: 'https://app.lobehub.com',
        },
      });

      await expect(resolveToken({})).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when no stored credentials', async () => {
      vi.mocked(getValidToken).mockResolvedValue(null);

      await expect(resolveToken({})).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
