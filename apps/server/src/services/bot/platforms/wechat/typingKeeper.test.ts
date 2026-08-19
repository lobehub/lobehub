// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTopicBotContext } from '@/types/topic';

import { wechatWindowKey } from './contextWindow';
import { startWechatTypingKeeper } from './typingKeeper';

// Heavyweight default-credential path is not exercised — tests inject resolveCredentials.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: { findEnabledByPlatformAndAppId: vi.fn(async () => null) },
}));
vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: vi.fn(() => null),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => null),
}));

/**
 * Fake redis covering what peekWindow and the active-mode gate touch. The
 * poller records `host` once it owns WeChat — that is the steady state these
 * tests run in unless a case overrides `strings`.
 */
const makeRedis = (
  hashes: Record<string, Record<string, string>> = {},
  strings: Record<string, string> = { 'wechat:poller:active-mode': 'host' },
) =>
  ({
    del: vi.fn(async () => 0),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => strings[key] ?? null),
    hgetall: vi.fn(async (key: string) => hashes[key] ?? null),
    hincrby: vi.fn(async () => 0),
    hset: vi.fn(async () => 1),
    llen: vi.fn(async () => 0),
    lpop: vi.fn(async () => null),
    lpush: vi.fn(async () => 1),
    ltrim: vi.fn(async () => 'OK'),
    pttl: vi.fn(async () => -1),
    rpush: vi.fn(async () => 1),
    set: vi.fn(async () => 'OK'),
    ttl: vi.fn(async () => 3600),
  }) as never;

const botContext = (overrides: Partial<ChatTopicBotContext> = {}): ChatTopicBotContext =>
  ({
    applicationId: 'app-1',
    isOwner: false,
    platformThreadId: 'wechat:dm:wx-user-1',
    ...overrides,
  }) as ChatTopicBotContext;

const credentials = async () => ({ botToken: 'token-1' });

describe('startWechatTypingKeeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pulses immediately and on the interval, and stops when told', async () => {
    const startTyping = vi.fn(async () => {});
    const redis = makeRedis({
      [wechatWindowKey('app-1', 'wx-user-1')]: { refreshedAt: '1', remaining: '9', token: 'ctx-9' },
    });

    const stop = await startWechatTypingKeeper(botContext(), {
      createApiClient: () => ({ startTyping }),
      intervalMs: 4000,
      redis,
      resolveCredentials: credentials,
    });

    expect(startTyping).toHaveBeenCalledTimes(1);
    expect(startTyping).toHaveBeenCalledWith('wx-user-1', 'ctx-9');

    await vi.advanceTimersByTimeAsync(8100);
    expect(startTyping).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(startTyping).toHaveBeenCalledTimes(3);
  });

  it('self-terminates after the max window even without stop()', async () => {
    const startTyping = vi.fn(async () => {});
    const redis = makeRedis({
      [wechatWindowKey('app-1', 'wx-user-1')]: { token: 'ctx-9' },
    });

    await startWechatTypingKeeper(botContext(), {
      createApiClient: () => ({ startTyping }),
      intervalMs: 4000,
      redis,
      resolveCredentials: credentials,
    });

    // Still pulsing at 2min: a tool-heavy step must not lose its indicator.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(startTyping.mock.calls.length).toBeGreaterThan(16);

    await vi.advanceTimersByTimeAsync(240_000);
    const callsAtMax = startTyping.mock.calls.length;
    // 5min cap → ~75 interval pulses + the immediate one; nothing after.
    expect(callsAtMax).toBeLessThanOrEqual(76);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(startTyping).toHaveBeenCalledTimes(callsAtMax);
  });

  it('is a no-op for non-wechat runs', async () => {
    const startTyping = vi.fn(async () => {});
    const stop = await startWechatTypingKeeper(
      botContext({ platformThreadId: 'discord:channel:123' }),
      {
        createApiClient: () => ({ startTyping }),
        redis: makeRedis(),
        resolveCredentials: credentials,
      },
    );
    stop();
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('is a no-op while the gateway still manages wechat', async () => {
    const startTyping = vi.fn(async () => {});
    // No active-mode record = pre-migration reality: the gateway owns WeChat.
    const redis = makeRedis({ [wechatWindowKey('app-1', 'wx-user-1')]: { token: 'ctx-9' } }, {});
    const stop = await startWechatTypingKeeper(botContext(), {
      createApiClient: () => ({ startTyping }),
      redis,
      resolveCredentials: credentials,
    });
    stop();
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('is a no-op without a send-window context token', async () => {
    const startTyping = vi.fn(async () => {});
    const stop = await startWechatTypingKeeper(botContext(), {
      createApiClient: () => ({ startTyping }),
      redis: makeRedis(), // empty window, no legacy token
      resolveCredentials: credentials,
    });
    stop();
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('is a no-op when credentials cannot be resolved, and never throws', async () => {
    const redis = makeRedis({
      [wechatWindowKey('app-1', 'wx-user-1')]: { token: 'ctx-9' },
    });
    const stop = await startWechatTypingKeeper(botContext(), {
      redis,
      resolveCredentials: async () => null,
    });
    expect(stop).toBeTypeOf('function');
    stop();
  });
});
