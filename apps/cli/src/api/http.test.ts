import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getValidToken } from '../auth/refresh';
import { loadSettings } from '../settings';
import { log } from '../utils/logger';
import { getAuthInfo } from './http';

vi.mock('../auth/refresh', () => ({
  getValidToken: vi.fn(),
}));
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue({ serverUrl: 'https://app.lobehub.com' }),
}));
vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('getAuthInfo', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalApiKey = process.env.LOBEHUB_CLI_API_KEY;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    delete process.env.LOBEHUB_CLI_API_KEY;
    vi.mocked(loadSettings).mockReturnValue({ serverUrl: 'https://app.lobehub.com' });
  });

  afterEach(() => {
    process.env.LOBEHUB_CLI_API_KEY = originalApiKey;
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('should prefer stored JWT auth even when LOBEHUB_CLI_API_KEY is set', async () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-env-test';
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: {
        accessToken: 'jwt-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: 'refresh-token',
      },
    });

    const result = await getAuthInfo();

    expect(result).toEqual({
      accessToken: 'jwt-token',
      headers: {
        'Content-Type': 'application/json',
        'Oidc-Auth': 'jwt-token',
        'X-lobe-chat-auth': expect.any(String),
      },
      serverUrl: 'https://app.lobehub.com',
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('should reject env API key when no JWT auth is available', async () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-env-test';
    vi.mocked(getValidToken).mockResolvedValue(null);

    await expect(getAuthInfo()).rejects.toThrow('process.exit');

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('API key auth from LOBEHUB_CLI_API_KEY is not supported'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should require login when neither JWT nor env API key is available', async () => {
    vi.mocked(getValidToken).mockResolvedValue(null);

    await expect(getAuthInfo()).rejects.toThrow('process.exit');

    expect(log.error).toHaveBeenCalledWith("No authentication found. Run 'lh login' first.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
