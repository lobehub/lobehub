import { readFile, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchKimiCodeQuota } from './kimiCodeQuota';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: () => '/home/test',
}));

const CREDENTIALS_PATH = '/home/test/.kimi-code/credentials/kimi-code.json';

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const NOW_SECONDS = Math.floor(NOW / 1000);
const FRESH_EXPIRES_AT = NOW_SECONDS + 3600;
const STALE_EXPIRES_AT = NOW_SECONDS - 3600;

const credentialsJson = (expiresAt: number, accessToken = 'file-token') =>
  JSON.stringify({
    access_token: accessToken,
    expires_at: expiresAt,
    expires_in: 3600,
    refresh_token: 'refresh-token',
    scope: 'openid',
    token_type: 'Bearer',
  });

const okResponse = (payload: unknown) =>
  ({ json: async () => payload, ok: true, status: 200 }) as Response;

const fullUsagePayload = {
  boosterWallet: {
    balance: { amount: 25_000_000_000, amountLeft: 10_000_000_000, type: 'BOOSTER' },
    monthlyChargeLimit: { currency: 'CNY', priceInCents: 10_000_000_000 },
    monthlyChargeLimitEnabled: true,
    monthlyUsed: { currency: 'CNY', priceInCents: 0 },
  },
  usages: {
    limit_5h: { reset_time: '2026-09-20T14:42:21Z', used_ratio: 0.256 },
    limit_7d: { reset_time: '2026-09-26T12:00:00Z', used_ratio: 0.147 },
    limit_month_code: { reset_time: '2026-10-01T00:00:00Z', used_ratio: 0.333 },
    limit_month_total: { reset_time: '2026-10-01T00:00:00Z', used_ratio: 0.5 },
  },
};

const identityPayload = {
  email: 'user@example.com',
  nickname: 'moonwalker',
  user_id: 'u_123',
};

const mockKimiApi = (usagePayload: unknown, identity: unknown = null) => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/me')) {
      return identity === null ? ({ ok: false, status: 404 } as Response) : okResponse(identity);
    }
    return okResponse(usagePayload);
  });
};

describe('fetchKimiCodeQuota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('KIMI_CODE_BASE_URL', '');
    vi.stubEnv('KIMI_CODE_HOME', '');
    vi.mocked(readFile).mockReset();
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockReset();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports missing credentials without touching the network', async () => {
    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({
      error: null,
      extraUsage: null,
      monthly: null,
      monthlyCode: null,
      provider: 'kimi-code',
      reason: 'credentials-not-found',
      session: null,
      status: 'unavailable',
      updatedAt: NOW,
      weekly: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps all four usage windows and the booster wallet from a fresh file login', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi(fullUsagePayload, identityPayload);

    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({
      error: null,
      extraUsage: {
        balanceCents: 10_000,
        currency: 'CNY',
        monthlyChargeLimitCents: 10_000_000_000,
        monthlyChargeLimitEnabled: true,
        monthlyUsedCents: 0,
        totalCents: 25_000,
      },
      identity: {
        displayName: 'moonwalker',
        email: 'user@example.com',
        externalAccountId: 'u_123',
      },
      monthly: {
        resetsAt: Date.parse('2026-10-01T00:00:00Z'),
        usedPercent: 50,
        windowMinutes: 43_200,
      },
      monthlyCode: { usedPercent: 33, windowMinutes: 43_200 },
      provider: 'kimi-code',
      session: {
        resetsAt: Date.parse('2026-09-20T14:42:21Z'),
        usedPercent: 26,
        windowMinutes: 300,
      },
      status: 'ok',
      updatedAt: NOW,
      weekly: {
        resetsAt: Date.parse('2026-09-26T12:00:00Z'),
        usedPercent: 15,
        windowMinutes: 10_080,
      },
    });
    expect(result.readings?.map((reading) => reading.limitType)).toEqual([
      'session',
      'weekly_all',
      'month_total',
      'month_code',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.kimi.com/coding/v1/usages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer file-token' }),
        signal: expect.any(AbortSignal),
      }),
    );
    // A fresh token is used as-is: no refresh round-trip.
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps windows without a reset time and omits windows the payload lacks', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi({ usages: { limit_5h: { used_ratio: 0.1 } } });

    const result = await fetchKimiCodeQuota();

    expect(result.status).toBe('ok');
    expect(result.session).toEqual({ resetsAt: null, usedPercent: 10, windowMinutes: 300 });
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.monthlyCode).toBeNull();
    expect(result.extraUsage).toBeNull();
  });

  it('ignores a non-BOOSTER balance and defaults the currency to USD', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi({
      boosterWallet: { balance: { amount: 25_000_000_000, type: 'CREDIT' } },
      usages: {},
    });

    const result = await fetchKimiCodeQuota();

    expect(result.extraUsage).toBeNull();
  });

  it('rounds fixed-point money, rounding sub-cent remainders up', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi({
      boosterWallet: {
        balance: { amount: 1_500_000, amountLeft: 500_000, type: 'BOOSTER' },
        monthlyChargeLimitEnabled: false,
      },
      usages: {},
    });

    const result = await fetchKimiCodeQuota();

    expect(result.extraUsage).toEqual({
      balanceCents: 1,
      currency: 'USD',
      monthlyChargeLimitCents: 0,
      monthlyChargeLimitEnabled: false,
      monthlyUsedCents: 0,
      totalCents: 2,
    });
  });

  it('treats a missing amountLeft as a zero balance and a non-positive amount as no wallet', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi({
      boosterWallet: { balance: { amount: 25_000_000_000, type: 'BOOSTER' } },
      usages: {},
    });

    const result = await fetchKimiCodeQuota();
    expect(result.extraUsage).toMatchObject({ balanceCents: 0, totalCents: 25_000 });

    mockKimiApi({
      boosterWallet: { balance: { amount: 0, amountLeft: 0, type: 'BOOSTER' } },
      usages: {},
    });

    const empty = await fetchKimiCodeQuota();
    expect(empty.extraUsage).toBeNull();
  });

  it('refreshes a near-expiry token and persists the rotated credentials', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(STALE_EXPIRES_AT, 'stale-token'));
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://auth.kimi.com/api/oauth/token') {
        return okResponse({ access_token: 'new-token', expires_in: 7200 });
      }
      if (url.endsWith('/me')) return { ok: false, status: 404 } as Response;
      return okResponse({ usages: { limit_5h: { used_ratio: 0.5 } } });
    });

    const result = await fetchKimiCodeQuota();

    expect(result.status).toBe('ok');
    expect(fetch).toHaveBeenCalledWith(
      'https://auth.kimi.com/api/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const refreshInit = vi.mocked(fetch).mock.calls[0][1];
    expect(String(refreshInit?.body)).toContain('grant_type=refresh_token');
    expect(String(refreshInit?.body)).toContain('refresh_token=refresh-token');
    expect(String(refreshInit?.body)).toContain('client_id=17e5f671-d194-4dfb-9706-5516cb48c098');
    // The refreshed token authorizes the usage call.
    expect(fetch).toHaveBeenCalledWith(
      'https://api.kimi.com/coding/v1/usages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
    // The credential file is rewritten with the merged tokens and 0600 mode.
    expect(writeFile).toHaveBeenCalledWith(
      CREDENTIALS_PATH,
      expect.any(String),
      expect.objectContaining({ mode: 0o600 }),
    );
    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
    expect(written).toMatchObject({
      access_token: 'new-token',
      expires_at: NOW_SECONDS + 7200,
      // The old refresh token is kept when the response lacks one.
      refresh_token: 'refresh-token',
    });
  });

  it('reports credentials-expired when the refresh is rejected', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(STALE_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ error: 'invalid_grant' }),
      ok: false,
      status: 400,
    } as Response);

    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({ reason: 'credentials-expired', status: 'unavailable' });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('reports credentials-expired for an expired login without a refresh token', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ access_token: 'stale-token', expires_at: STALE_EXPIRES_AT }),
    );

    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({ reason: 'credentials-expired', status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a refresh transport failure as an error', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(STALE_EXPIRES_AT));
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await fetchKimiCodeQuota();

    expect(result.status).toBe('error');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('surfaces a usage API 500 as an error', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({ status: 'error' });
    expect(result.reason).toBeUndefined();
    expect(result.error).toContain('500');
  });

  it('surfaces a usage API 401 as an error, not a credential state', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    const result = await fetchKimiCodeQuota();

    expect(result).toMatchObject({ status: 'error' });
    expect(result.error).toContain('401');
  });

  it('honors KIMI_CODE_HOME and KIMI_CODE_BASE_URL from the agent env', async () => {
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (file === '/custom/kimi/credentials/kimi-code.json') {
        return credentialsJson(FRESH_EXPIRES_AT, 'custom-token');
      }
      throw new Error('ENOENT');
    });
    mockKimiApi({ usages: { limit_5h: { used_ratio: 0.1 } } });

    const result = await fetchKimiCodeQuota({
      env: {
        KIMI_CODE_BASE_URL: 'https://api.kimi.ai/coding/v1',
        KIMI_CODE_HOME: '/custom/kimi',
      },
    });

    expect(result.status).toBe('ok');
    expect(readFile).toHaveBeenCalledWith('/custom/kimi/credentials/kimi-code.json', 'utf8');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.kimi.ai/coding/v1/usages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer custom-token' }),
      }),
    );
  });

  it('prefers the explicit kimiCodeHomePath over the env', async () => {
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (file === '/explicit/kimi/credentials/kimi-code.json') {
        return credentialsJson(FRESH_EXPIRES_AT);
      }
      throw new Error('ENOENT');
    });
    mockKimiApi({ usages: {} });

    const result = await fetchKimiCodeQuota({
      env: { KIMI_CODE_HOME: '/custom/kimi' },
      kimiCodeHomePath: '/explicit/kimi',
    });

    expect(result.status).toBe('ok');
    expect(readFile).toHaveBeenCalledWith('/explicit/kimi/credentials/kimi-code.json', 'utf8');
  });

  it('keeps the snapshot ok when the identity endpoint fails', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    mockKimiApi({ usages: { limit_5h: { used_ratio: 0.1 } } });

    const result = await fetchKimiCodeQuota();

    expect(result.status).toBe('ok');
    expect(result.identity).toBeNull();
  });

  it('aborts a hanging usage request and reports a timeout', async () => {
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const resultPromise = fetchKimiCodeQuota();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  });
});
