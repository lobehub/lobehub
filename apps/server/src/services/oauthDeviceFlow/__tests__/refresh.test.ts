// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureFreshOAuthToken } from '../refresh';

const { mockGetAiProviderById, mockUpdateConfig } = vi.hoisted(() => ({
  mockGetAiProviderById: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/database/models/aiProvider', () => ({
  // class-based mock so it survives vi.clearAllMocks/resetAllMocks
  AiProviderModel: class {
    getAiProviderById = mockGetAiProviderById;
    updateConfig = mockUpdateConfig;
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
    initWithEnvKey: () => Promise.resolve({ encrypt: (s: string) => s }),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** Build an unsigned JWT with the given exp claim (seconds) */
const buildJwt = (expSeconds: number) => {
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expSeconds })}.sig`;
};

const config = {
  clientId: 'test-client-id',
  deviceCodeEndpoint: 'https://auth.example.com/device/code',
  refreshTokenGrant: true,
  scopes: ['offline_access'],
  tokenEndpoint: 'https://auth.example.com/token',
};

const db = {} as any;

let userSeq = 0;
/** Fresh identity per test to avoid single-flight key collisions */
const makeParams = (keyVaults: any) => ({
  config,
  db,
  keyVaults,
  providerId: 'supergrok',
  userId: `user-${++userSeq}`,
});

const tokenResponse = (body: object, ok = true) => ({
  json: () => Promise.resolve(body),
  ok,
  status: ok ? 200 : 400,
});

describe('ensureFreshOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns keyVaults untouched when not connected via OAuth', async () => {
    const keyVaults = { apiKey: 'sk-xxx' };
    const result = await ensureFreshOAuthToken(makeParams(keyVaults));

    expect(result).toBe(keyVaults);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns keyVaults untouched when there is no refresh token', async () => {
    const keyVaults = { oauthAccessToken: 'access-token' };
    const result = await ensureFreshOAuthToken(makeParams(keyVaults));

    expect(result).toBe(keyVaults);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips refresh when the token is still fresh', async () => {
    const keyVaults = {
      oauthAccessToken: 'access-token',
      oauthRefreshToken: 'refresh-token',
      oauthTokenExpiresAt: String(Date.now() + 30 * 60 * 1000),
    };

    const result = await ensureFreshOAuthToken(makeParams(keyVaults));

    expect(result).toBe(keyVaults);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes when the stored expiry is within the skew window', async () => {
    mockFetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: 'new-access',
        expires_in: 3600,
        refresh_token: 'new-refresh',
        token_type: 'bearer',
      }),
    );

    const result = await ensureFreshOAuthToken(
      makeParams({
        oauthAccessToken: 'old-access',
        oauthRefreshToken: 'old-refresh',
        oauthTokenExpiresAt: String(Date.now() + 30 * 1000),
      }),
    );

    expect(result.oauthAccessToken).toBe('new-access');
    expect(result.oauthRefreshToken).toBe('new-refresh');
    expect(Number(result.oauthTokenExpiresAt)).toBeGreaterThan(Date.now() + 3000 * 1000);

    // refresh_token grant request shape
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(config.tokenEndpoint);
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain('refresh_token=old-refresh');

    // rotated pair persisted before returning
    expect(mockUpdateConfig).toHaveBeenCalledWith(
      'supergrok',
      expect.objectContaining({
        keyVaults: expect.objectContaining({
          oauthAccessToken: 'new-access',
          oauthRefreshToken: 'new-refresh',
        }),
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('refreshes when only the JWT exp claim says the token is expiring', async () => {
    mockFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'new-access', refresh_token: 'new-refresh' }),
    );

    const result = await ensureFreshOAuthToken(
      makeParams({
        // no stored expiry — JWT exp in the past is the only signal
        oauthAccessToken: buildJwt(Math.floor(Date.now() / 1000) - 10),
        oauthRefreshToken: 'old-refresh',
      }),
    );

    expect(result.oauthAccessToken).toBe('new-access');
  });

  it('derives expiry from the new JWT when expires_in is missing', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800;
    mockFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: buildJwt(exp), refresh_token: 'new-refresh' }),
    );

    const result = await ensureFreshOAuthToken(
      makeParams({
        oauthAccessToken: 'old-access',
        oauthRefreshToken: 'old-refresh',
        oauthTokenExpiresAt: String(Date.now() - 1000),
      }),
    );

    expect(Number(result.oauthTokenExpiresAt)).toBe(exp * 1000);
  });

  it('keeps the old refresh token when the provider does not rotate', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse({ access_token: 'new-access' }));

    const result = await ensureFreshOAuthToken(
      makeParams({
        oauthAccessToken: 'old-access',
        oauthRefreshToken: 'old-refresh',
        oauthTokenExpiresAt: String(Date.now() - 1000),
      }),
    );

    expect(result.oauthRefreshToken).toBe('old-refresh');
  });

  it('collapses concurrent refreshes onto a single HTTP call', async () => {
    mockFetch.mockResolvedValue(
      tokenResponse({ access_token: 'new-access', refresh_token: 'new-refresh' }),
    );

    const params = makeParams({
      oauthAccessToken: 'old-access',
      oauthRefreshToken: 'old-refresh',
      oauthTokenExpiresAt: String(Date.now() - 1000),
    });

    const [a, b, c] = await Promise.all([
      ensureFreshOAuthToken(params),
      ensureFreshOAuthToken(params),
      ensureFreshOAuthToken(params),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a.oauthAccessToken).toBe('new-access');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('still returns fresh tokens when persisting fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'new-access', refresh_token: 'new-refresh' }),
    );
    mockUpdateConfig.mockRejectedValueOnce(new Error('db down'));

    const result = await ensureFreshOAuthToken(
      makeParams({
        oauthAccessToken: 'old-access',
        oauthRefreshToken: 'old-refresh',
        oauthTokenExpiresAt: String(Date.now() - 1000),
      }),
    );

    expect(result.oauthAccessToken).toBe('new-access');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe('invalid_grant self-healing', () => {
    it('uses stored credentials when another instance already rotated to a fresh pair', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse({ error: 'invalid_grant' }, false));
      mockGetAiProviderById.mockResolvedValueOnce({
        keyVaults: {
          oauthAccessToken: 'rotated-access',
          oauthRefreshToken: 'rotated-refresh',
          oauthTokenExpiresAt: String(Date.now() + 30 * 60 * 1000),
        },
      });

      const result = await ensureFreshOAuthToken(
        makeParams({
          oauthAccessToken: 'old-access',
          oauthRefreshToken: 'old-refresh',
          oauthTokenExpiresAt: String(Date.now() - 1000),
        }),
      );

      expect(result.oauthAccessToken).toBe('rotated-access');
      // no second refresh call needed
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries once with the stored refresh token when the rotated access token is also stale', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse({ error: 'invalid_grant' }, false))
        .mockResolvedValueOnce(
          tokenResponse({
            access_token: 'second-access',
            expires_in: 3600,
            refresh_token: 'second-refresh',
          }),
        );
      mockGetAiProviderById.mockResolvedValueOnce({
        keyVaults: {
          oauthAccessToken: 'rotated-but-stale-access',
          oauthRefreshToken: 'rotated-refresh',
          oauthTokenExpiresAt: String(Date.now() - 1000),
        },
      });

      const result = await ensureFreshOAuthToken(
        makeParams({
          oauthAccessToken: 'old-access',
          oauthRefreshToken: 'old-refresh',
          oauthTokenExpiresAt: String(Date.now() - 1000),
        }),
      );

      expect(result.oauthAccessToken).toBe('second-access');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, retryInit] = mockFetch.mock.calls[1];
      expect(retryInit.body).toContain('refresh_token=rotated-refresh');
    });

    it('throws InvalidProviderAPIKey when the stored refresh token matches the rejected one', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse({ error: 'invalid_grant' }, false));
      mockGetAiProviderById.mockResolvedValueOnce({
        keyVaults: {
          oauthAccessToken: 'old-access',
          oauthRefreshToken: 'old-refresh',
        },
      });

      await expect(
        ensureFreshOAuthToken(
          makeParams({
            oauthAccessToken: 'old-access',
            oauthRefreshToken: 'old-refresh',
            oauthTokenExpiresAt: String(Date.now() - 1000),
          }),
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });

      // keyVaults must NOT be cleared on failure
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('throws InvalidProviderAPIKey when the retry also gets invalid_grant', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse({ error: 'invalid_grant' }, false))
        .mockResolvedValueOnce(tokenResponse({ error: 'invalid_grant' }, false));
      mockGetAiProviderById.mockResolvedValueOnce({
        keyVaults: {
          oauthAccessToken: 'rotated-but-stale-access',
          oauthRefreshToken: 'rotated-refresh',
          oauthTokenExpiresAt: String(Date.now() - 1000),
        },
      });

      await expect(
        ensureFreshOAuthToken(
          makeParams({
            oauthAccessToken: 'old-access',
            oauthRefreshToken: 'old-refresh',
            oauthTokenExpiresAt: String(Date.now() - 1000),
          }),
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
    });
  });
});
