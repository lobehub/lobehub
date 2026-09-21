import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getKimiCodeQuota } from '../kimiCodeQuota';

let fixtureDir: string;

const okResponse = (payload: unknown) =>
  ({ json: async () => payload, ok: true, status: 200 }) as Response;

// Reset times must stay in the future relative to the test run — a fixed ISO
// string goes stale and the window reads as rolled over (0%, no countdown).
const RESET_5H = new Date(Date.now() + 2 * 3_600_000).toISOString();
const RESET_7D = new Date(Date.now() + 5 * 86_400_000).toISOString();
const RESET_MONTH = new Date(Date.now() + 10 * 86_400_000).toISOString();

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'kimi-code-quota-'));
  await mkdir(path.join(fixtureDir, 'credentials'), { recursive: true });
  await writeFile(
    path.join(fixtureDir, 'credentials', 'kimi-code.json'),
    JSON.stringify({
      access_token: 'fixture-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh',
    }),
  );
});

afterAll(async () => {
  await rm(fixtureDir, { force: true, recursive: true });
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/me')) {
      return okResponse({ email: 'user@example.com', nickname: 'moonwalker', user_id: 'u_123' });
    }
    return okResponse({
      boosterWallet: {
        balance: { amount: 25_000_000_000, amountLeft: 10_000_000_000, type: 'BOOSTER' },
        monthlyChargeLimit: { currency: 'CNY', priceInCents: 10_000_000_000 },
        monthlyChargeLimitEnabled: true,
        monthlyUsed: { currency: 'CNY', priceInCents: 0 },
      },
      usages: {
        limit_5h: { reset_time: RESET_5H, used_ratio: 0.256 },
        limit_7d: { reset_time: RESET_7D, used_ratio: 0.147 },
        limit_month_code: { reset_time: RESET_MONTH, used_ratio: 0.333 },
        limit_month_total: { reset_time: RESET_MONTH, used_ratio: 0.5 },
      },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getKimiCodeQuota', () => {
  it('reads and maps every usage window through the Kimi usage API', async () => {
    const result = await getKimiCodeQuota({
      env: { KIMI_CODE_HOME: fixtureDir },
      force: true,
    });

    expect(result).toMatchObject({
      error: null,
      provider: 'kimi-code',
      identity: { email: 'user@example.com', externalAccountId: 'u_123' },
      session: {
        resetsAt: Date.parse(RESET_5H),
        usedPercent: 26,
        windowMinutes: 300,
      },
      status: 'ok',
      weekly: {
        resetsAt: Date.parse(RESET_7D),
        usedPercent: 15,
        windowMinutes: 10_080,
      },
    });
    expect(result.extraUsage).toEqual({
      balanceCents: 10_000,
      currency: 'CNY',
      monthlyChargeLimitCents: 10_000_000_000,
      monthlyChargeLimitEnabled: true,
      monthlyUsedCents: 0,
      totalCents: 25_000,
    });
    expect(result.readings).toHaveLength(4);
    expect(result.readings?.[0]).toMatchObject({
      limitType: 'session',
      scopeKey: '',
      utilization: 26,
      windowMinutes: 300,
    });
    expect(result.readings?.[3]).toMatchObject({
      limitType: 'month_code',
      utilization: 33,
      windowMinutes: 43_200,
    });
  });

  it('reports missing credentials without touching the network', async () => {
    const result = await getKimiCodeQuota({
      env: { KIMI_CODE_HOME: path.join(fixtureDir, 'missing') },
      force: true,
    });

    expect(result).toMatchObject({
      error: null,
      provider: 'kimi-code',
      reason: 'credentials-not-found',
      status: 'unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
