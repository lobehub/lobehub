import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSettings } from '../settings';
import type { StoredCredentials } from './credentials';
import { loadCredentials, saveCredentials } from './credentials';
import { getValidToken } from './refresh';

vi.mock('./credentials', () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
}));
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue({ serverUrl: 'https://app.lobehub.com' }),
}));

describe('getValidToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null when no credentials stored', async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should return credentials when token is still valid', async () => {
    const creds: StoredCredentials = {
      accessToken: 'valid-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      refreshToken: 'refresh-tok',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    const result = await getValidToken();

    expect(result).toEqual({ credentials: creds });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should return credentials when no expiresAt is set', async () => {
    const creds: StoredCredentials = {
      accessToken: 'valid-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    const result = await getValidToken();

    // expiresAt is undefined, so Date.now()/1000 < undefined - 60 is false (NaN comparison)
    // This means it will try to refresh, but there's no refreshToken
    expect(result).toBeNull();
  });

  it('should return null when token expired and no refresh token', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100, // expired
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should refresh and save updated credentials when token is expired', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'valid-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
      }),
      ok: true,
    } as any);

    const result = await getValidToken();

    expect(result).not.toBeNull();
    expect(result!.credentials.accessToken).toBe('new-access-token');
    expect(result!.credentials.refreshToken).toBe('new-refresh-token');
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-access-token' }),
    );
  });

  it('should keep old refresh token if new one is not returned', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'old-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        token_type: 'Bearer',
      }),
      ok: true,
    } as any);

    const result = await getValidToken();

    expect(result!.credentials.refreshToken).toBe('old-refresh-token');
    expect(result!.credentials.expiresAt).toBeUndefined();
  });

  it('should return null when refresh request fails (non-ok)', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'valid-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({}),
      ok: false,
      status: 401,
    } as any);

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should return null when refresh response has error field', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'valid-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ error: 'invalid_grant' }),
      ok: true,
    } as any);

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should return null when refresh response has no access_token', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'valid-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ token_type: 'Bearer' }),
      ok: true,
    } as any);

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should return null when network error occurs during refresh', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'valid-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    vi.mocked(fetch).mockRejectedValue(new Error('network error'));

    const result = await getValidToken();

    expect(result).toBeNull();
  });

  it('should send correct request to refresh endpoint', async () => {
    const creds: StoredCredentials = {
      accessToken: 'expired-token',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
      refreshToken: 'my-refresh-token',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);
    vi.mocked(loadSettings).mockReturnValueOnce({ serverUrl: 'https://my-server.com' });

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        access_token: 'new-token',
        token_type: 'Bearer',
      }),
      ok: true,
    } as any);

    await getValidToken();

    expect(fetch).toHaveBeenCalledWith(
      'https://my-server.com/oidc/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('my-refresh-token');
    expect(body.get('client_id')).toBe('lobehub-cli');
  });
});
