import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCodexQuota } from './codexQuota';

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

const mockRpcRateLimits = (child: RpcChild, result: unknown) => {
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

    if (message.method === 'account/rateLimits/read') {
      setTimeout(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result,
            })}\n`,
          ),
        );
      }, 0);
    }
  });
};

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
            status: 'available',
            expires_at: '2026-06-25T12:00:00Z',
            granted_at: '2026-06-18T12:00:00Z',
          },
          {
            status: 'available',
            expires_at: '2026-06-24T12:00:00Z',
            granted_at: '2026-06-17T12:00:00Z',
          },
          {
            status: 'redeemed',
            expires_at: '2026-06-23T12:00:00Z',
            granted_at: '2026-06-16T12:00:00Z',
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
        totalEarnedCount: 3,
        nextExpiresAt: Date.parse('2026-06-24T12:00:00Z'),
      },
    });
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
          Authorization: 'Bearer access-token',
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
      },
    });
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
    await vi.advanceTimersByTimeAsync(2000);
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
});
