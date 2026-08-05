import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeCodexRateLimitResetCredit, fetchCodexQuota } from './codexQuota';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

class RpcChild extends EventEmitter {
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
  };
  stdout = new EventEmitter();

  kill = vi.fn();
}

const mockRpcMethods = (
  child: RpcChild,
  methods: Record<string, { error?: string; result?: unknown }>,
) => {
  child.stdin.write.mockImplementation((line: string) => {
    const message = JSON.parse(line) as { id?: number; method?: string };

    if (message.method === 'initialize') {
      setTimeout(() => {
        child.stdout.emit(
          'data',
          Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })}\n`),
        );
      }, 0);
    }

    const response = message.method ? methods[message.method] : undefined;
    if (response) {
      setTimeout(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({
              ...(response.error ? { error: { message: response.error } } : {}),
              jsonrpc: '2.0',
              id: message.id,
              ...(!response.error ? { result: response.result } : {}),
            })}\n`,
          ),
        );
      }, 0);
    }
  });
};

const mockRpcRateLimits = (child: RpcChild, result: unknown) =>
  mockRpcMethods(child, { 'account/rateLimits/read': { result } });

describe('fetchCodexQuota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(readFile).mockReset();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fills reset-credit metadata from the Codex backend when RPC omits it', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        tokens: {
          access_token: 'access-token',
          account_id: 'account-id',
        },
      }),
    );
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        available_count: 2,
        total_earned_count: 3,
        credits: [
          {
            description: 'Use this when a Codex limit is exhausted.',
            status: 'available',
            expires_at: '2026-06-25T12:00:00Z',
            granted_at: '2026-06-18T12:00:00Z',
            id: 'credit-later',
            reset_type: 'codex_all_limits',
            title: 'Codex reset',
          },
          {
            description: 'Expires first.',
            status: 'available',
            expires_at: '2026-06-24T12:00:00Z',
            granted_at: '2026-06-17T12:00:00Z',
            id: 'credit-first',
            reset_type: 'codex_all_limits',
            title: 'Early reset',
          },
          {
            status: 'redeemed',
            expires_at: '2026-06-23T12:00:00Z',
            granted_at: '2026-06-16T12:00:00Z',
            id: 'credit-used',
            redeem_started_at: '2026-06-19T10:00:00Z',
            redeemed_at: '2026-06-19T10:01:00Z',
          },
        ],
      }),
    } as Response);

    mockRpcRateLimits(child, {
      rateLimits: {
        primary: { resetsAt: 1_718_800_000, usedPercent: 4, windowDurationMins: 15 },
        secondary: { resetsAt: 1_719_300_000, usedPercent: 52, windowDurationMins: 60 },
      },
    });

    const resultPromise = fetchCodexQuota({
      command: '/custom/bin/codex',
      env: { CODEX_HOME: '/tmp/codex-home', LOBE_TEST_ENV: '1' },
    });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result).toMatchObject({
      provider: 'codex',
      status: 'ok',
      session: {
        resetsAt: 1_718_800_000 * 1000,
        usedPercent: 4,
        windowMinutes: 15,
      },
      weekly: {
        resetsAt: 1_719_300_000 * 1000,
        usedPercent: 52,
        windowMinutes: 60,
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [
          expect.objectContaining({
            expiresAt: Date.parse('2026-06-25T12:00:00Z'),
            grantedAt: Date.parse('2026-06-18T12:00:00Z'),
            id: 'credit-later',
            resetType: 'codex_all_limits',
            status: 'available',
            title: 'Codex reset',
          }),
          expect.objectContaining({
            expiresAt: Date.parse('2026-06-24T12:00:00Z'),
            id: 'credit-first',
            title: 'Early reset',
          }),
          expect.objectContaining({
            id: 'credit-used',
            redeemStartedAt: Date.parse('2026-06-19T10:00:00Z'),
            redeemedAt: Date.parse('2026-06-19T10:01:00Z'),
            status: 'redeemed',
          }),
        ],
        totalEarnedCount: 3,
        nextExpiresAt: Date.parse('2026-06-24T12:00:00Z'),
      },
    });
    expect(result.rateLimitResetCredits?.credits?.[0]).not.toHaveProperty('description');
    expect(readFile).toHaveBeenCalledWith('/tmp/codex-home/auth.json', 'utf8');
    expect(spawnMock).toHaveBeenCalledWith(
      '/custom/bin/codex',
      ['-s', 'read-only', '-a', 'untrusted', 'app-server'],
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_HOME: '/tmp/codex-home',
          LOBE_TEST_ENV: '1',
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer access-token',
          'ChatGPT-Account-Id': 'account-id',
          'OpenAI-Beta': 'codex-1',
        }),
      }),
    );
  });

  it('reads RPC quota when auth.json is unavailable', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    mockRpcRateLimits(child, {
      rateLimits: {
        primary: { resetsAt: 1_718_800_000, usedPercent: 7 },
        secondary: { resetsAt: 1_719_300_000, usedPercent: 41 },
      },
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [
          {
            description: 'RPC detail',
            expiresAt: '2026-06-27T12:00:00Z',
            grantedAt: '2026-06-20T10:00:00Z',
            id: 'rpc-credit',
            resetType: 'codex_all_limits',
            status: 'AVAILABLE',
            title: 'RPC reset',
          },
        ],
      },
    });

    const resultPromise = fetchCodexQuota({ command: '/custom/bin/codex' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result).toMatchObject({
      provider: 'codex',
      status: 'ok',
      session: {
        resetsAt: 1_718_800_000 * 1000,
        usedPercent: 7,
        windowMinutes: 300,
      },
      weekly: {
        resetsAt: 1_719_300_000 * 1000,
        usedPercent: 41,
        windowMinutes: 10_080,
      },
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [
          expect.objectContaining({
            expiresAt: Date.parse('2026-06-27T12:00:00Z'),
            grantedAt: Date.parse('2026-06-20T10:00:00Z'),
            id: 'rpc-credit',
            resetType: 'codex_all_limits',
            status: 'available',
            title: 'RPC reset',
          }),
        ],
        nextExpiresAt: Date.parse('2026-06-27T12:00:00Z'),
      },
    });
    expect(result.rateLimitResetCredits?.credits?.[0]).not.toHaveProperty('description');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps and deduplicates every app-server rate-limit bucket', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    mockRpcRateLimits(child, {
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { resetsAt: 1_718_800_000, usedPercent: 12, windowDurationMins: 300 },
        secondary: { resetsAt: 1_719_300_000, usedPercent: 24, windowDurationMins: 10_080 },
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          primary: { resetsAt: 1_718_800_100, usedPercent: 99, windowDurationMins: 300 },
        },
        codex_other: {
          limitName: 'Codex Other',
          primary: { resetsAt: 1_718_900_000, usedPercent: 98, windowDurationMins: 60 },
          secondary: { resetsAt: 1_721_400_000, usedPercent: 40, windowDurationMins: 43_200 },
        },
      },
    });

    const resultPromise = fetchCodexQuota({ command: '/custom/bin/codex' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result.rateLimits).toEqual([
      {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          resetsAt: 1_718_800_000 * 1000,
          usedPercent: 12,
          windowMinutes: 300,
        },
        secondary: {
          resetsAt: 1_719_300_000 * 1000,
          usedPercent: 24,
          windowMinutes: 10_080,
        },
      },
      {
        limitId: 'codex_other',
        limitName: 'Codex Other',
        primary: {
          resetsAt: 1_718_900_000 * 1000,
          usedPercent: 98,
          windowMinutes: 60,
        },
        secondary: {
          resetsAt: 1_721_400_000 * 1000,
          usedPercent: 40,
          windowMinutes: 43_200,
        },
      },
    ]);
    expect(result.session).toEqual(result.rateLimits?.[0].primary);
    expect(result.weekly).toEqual(result.rateLimits?.[0].secondary);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns RPC quota when reset-credit enrichment times out', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        tokens: {
          access_token: 'access-token',
        },
      }),
    );
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>);
    mockRpcRateLimits(child, {
      rateLimits: {
        primary: { resetsAt: 1_718_800_000, usedPercent: 11 },
        secondary: { resetsAt: 1_719_300_000, usedPercent: 63 },
      },
      rateLimitResetCredits: {
        availableCount: 4,
      },
    });

    const resultPromise = fetchCodexQuota({ command: '/custom/bin/codex' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5001);
    const result = await resultPromise;

    expect(result).toMatchObject({
      provider: 'codex',
      status: 'ok',
      session: {
        resetsAt: 1_718_800_000 * 1000,
        usedPercent: 11,
        windowMinutes: 300,
      },
      weekly: {
        resetsAt: 1_719_300_000 * 1000,
        usedPercent: 63,
        windowMinutes: 10_080,
      },
      rateLimitResetCredits: {
        availableCount: 4,
        nextExpiresAt: null,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('consumes a specific reset credit through the Codex app-server', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    mockRpcMethods(child, {
      'account/rateLimitResetCredit/consume': { result: { outcome: 'reset' } },
    });

    const resultPromise = consumeCodexRateLimitResetCredit({
      command: '/custom/bin/codex',
      creditId: 'credit-first',
      idempotencyKey: 'redeem-request-1',
    });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(resultPromise).resolves.toBe('reset');
    const consumeMessage = child.stdin.write.mock.calls
      .map(([line]) => JSON.parse(line as string))
      .find((message) => message.method === 'account/rateLimitResetCredit/consume');
    expect(consumeMessage).toMatchObject({
      params: {
        creditId: 'credit-first',
        idempotencyKey: 'redeem-request-1',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the backend consume endpoint with the same idempotency key', async () => {
    const child = new RpcChild();
    spawnMock.mockReturnValue(child);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        tokens: {
          access_token: 'access-token',
          account_id: 'account-id',
        },
      }),
    );
    mockRpcMethods(child, {
      'account/rateLimitResetCredit/consume': { error: 'Method not found' },
    });
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ code: 'already_redeemed' }),
      ok: true,
    } as Response);

    const resultPromise = consumeCodexRateLimitResetCredit({
      command: '/custom/bin/codex',
      creditId: 'credit-first',
      idempotencyKey: 'redeem-request-2',
    });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(resultPromise).resolves.toBe('alreadyRedeemed');
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
      expect.objectContaining({
        body: JSON.stringify({
          credit_id: 'credit-first',
          redeem_request_id: 'redeem-request-2',
        }),
        headers: expect.objectContaining({
          'Authorization': 'Bearer access-token',
          'ChatGPT-Account-Id': 'account-id',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
      }),
    );
  });
});
