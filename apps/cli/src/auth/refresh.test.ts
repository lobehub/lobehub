import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerUrl } from '../settings';
import type { StoredCredentials } from './credentials';
import { loadCredentials, saveCredentials } from './credentials';
import { describeTokenLookup, getValidToken } from './refresh';

vi.mock('./credentials', () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
}));
vi.mock('../settings', () => ({
  resolveServerUrl: vi.fn().mockReturnValue('https://app.lobehub.com'),
}));

const expiredCredentials = (refreshToken?: string): StoredCredentials => ({
  accessToken: 'expired-token',
  expiresAt: Math.floor(Date.now() / 1000) - 100,
  refreshToken,
});

describe('getValidToken', () => {
  beforeEach(() => {
    vi.mocked(loadCredentials).mockClear();
    vi.mocked(saveCredentials).mockClear();
    vi.mocked(resolveServerUrl).mockClear();
    vi.mocked(resolveServerUrl).mockReturnValue('https://app.lobehub.com');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should report no login when no credentials stored', async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);

    await expect(getValidToken()).resolves.toEqual({ status: 'no-login' });
  });

  it('should return credentials when token is still valid', async () => {
    const creds: StoredCredentials = {
      accessToken: 'valid-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      refreshToken: 'refresh-tok',
    };
    vi.mocked(loadCredentials).mockReturnValue(creds);

    const result = await getValidToken();

    expect(result).toEqual({ credentials: creds, status: 'ok' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should report no login when no expiresAt and nothing to refresh with', async () => {
    vi.mocked(loadCredentials).mockReturnValue({ accessToken: 'valid-token' });

    // expiresAt is undefined, so the validity check cannot pass and a refresh is attempted,
    // but there is no refresh token to attempt it with.
    await expect(getValidToken()).resolves.toEqual({ status: 'no-login' });
  });

  it('should report no login when token expired and no refresh token', async () => {
    vi.mocked(loadCredentials).mockReturnValue(expiredCredentials());

    await expect(getValidToken()).resolves.toEqual({ status: 'no-login' });
  });

  it('should refresh and save updated credentials when token is expired', async () => {
    vi.mocked(loadCredentials).mockReturnValue(expiredCredentials('valid-refresh-token'));

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

    expect(result.status).toBe('ok');
    expect(result).toMatchObject({
      credentials: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' },
    });
    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-access-token' }),
    );
  });

  it('should keep old refresh token if new one is not returned', async () => {
    vi.mocked(loadCredentials).mockReturnValue(expiredCredentials('old-refresh-token'));

    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        token_type: 'Bearer',
      }),
      ok: true,
    } as any);

    const result = await getValidToken();

    expect(result).toMatchObject({
      credentials: { expiresAt: undefined, refreshToken: 'old-refresh-token' },
    });
  });

  /**
   * The regression this classification exists for: a refresh that never got an answer used to be
   * indistinguishable from having no login at all, so every caller told the user to run `login`
   * and re-authenticate over what was usually a passing blip.
   */
  describe('separates a refused token from an unanswered request', () => {
    beforeEach(() => {
      vi.mocked(loadCredentials).mockReturnValue(expiredCredentials('stored-refresh-token'));
    });

    it('treats invalid_grant as a spent login', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          error: 'invalid_grant',
          error_description: 'grant request is invalid',
        }),
        ok: false,
        status: 400,
      } as any);

      await expect(getValidToken()).resolves.toEqual({
        detail: 'invalid_grant: grant request is invalid',
        status: 'spent',
      });
      expect(saveCredentials).not.toHaveBeenCalled();
    });

    it('treats a gateway failure as unavailable', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
        ok: false,
        status: 502,
      } as any);

      await expect(getValidToken()).resolves.toEqual({
        detail: 'HTTP 502',
        status: 'unavailable',
      });
    });

    it('treats a request timeout as unavailable', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue({}),
        ok: false,
        status: 408,
      } as any);

      await expect(getValidToken()).resolves.toMatchObject({ status: 'unavailable' });
    });

    it('treats a network error as unavailable and keeps the reason', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('fetch failed'));

      await expect(getValidToken()).resolves.toEqual({
        detail: 'fetch failed',
        status: 'unavailable',
      });
    });

    it('treats an OAuth error in a 2xx body as a spent login', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error: 'invalid_grant' }),
        ok: true,
      } as any);

      await expect(getValidToken()).resolves.toEqual({
        detail: 'invalid_grant',
        status: 'spent',
      });
    });

    it('treats a 2xx without an access token as unavailable', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue({ token_type: 'Bearer' }),
        ok: true,
      } as any);

      await expect(getValidToken()).resolves.toMatchObject({ status: 'unavailable' });
    });

    it('treats client-auth failure as a refusal, not a spent login', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error: 'invalid_client' }),
        ok: false,
        status: 401,
      } as any);

      await expect(getValidToken()).resolves.toEqual({
        detail: 'invalid_client',
        status: 'refused',
      });
    });

    /**
     * The shape that made this distinction worth having: a WAF in front of the token endpoint
     * answers 403 with no OAuth body at all. Calling that a spent login walks the user through a
     * pointless re-authentication straight back into the same wall.
     */
    it('treats a proxy 403 as a refusal, not a spent login', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token F')),
        ok: false,
        status: 403,
      } as any);

      await expect(getValidToken()).resolves.toEqual({
        detail: 'HTTP 403',
        status: 'refused',
      });
    });

    it('treats a wrong server URL (404) as a refusal', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
        ok: false,
        status: 404,
      } as any);

      await expect(getValidToken()).resolves.toMatchObject({ status: 'refused' });
    });
  });

  it('should send correct request to refresh endpoint', async () => {
    vi.mocked(loadCredentials).mockReturnValue(expiredCredentials('my-refresh-token'));
    vi.mocked(resolveServerUrl).mockReturnValueOnce('https://my-server.com');

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

describe('describeTokenLookup', () => {
  it('says the stored login survived when the server never answered', () => {
    const report = describeTokenLookup({ detail: 'fetch failed', status: 'unavailable' });

    expect(report?.detail).toContain('fetch failed');
    expect(report?.detail).toContain('untouched');
    // The whole point: it must not send the user off to re-authenticate.
    expect(report?.fix).not.toMatch(/run .*login/i);
    expect(report?.fix).toMatch(/retry/i);
  });

  /** Spent is the one status where signing in again is the remedy, so it has to say so. */
  it('tells the user to sign in again when the stored login is spent', () => {
    const report = describeTokenLookup({ detail: 'invalid_grant', status: 'spent' });

    expect(report?.detail).toContain('invalid_grant');
    expect(report?.fix).toContain('login');
  });

  it('does not send the user to sign in again over a refusal the credential did not cause', () => {
    const report = describeTokenLookup({ detail: 'HTTP 403', status: 'refused' });

    expect(report?.detail).toContain('HTTP 403');
    expect(report?.fix).toContain('signing in again will not change the answer');
  });

  it('leaves the caller its own wording when there is nothing to diagnose', () => {
    expect(describeTokenLookup({ status: 'no-login' })).toBeUndefined();
  });
});
