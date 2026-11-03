import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTelegramGuestSession,
  getTelegramGuestSessionMemorySizeForTest,
  initializeTelegramGuestSession,
  resetTelegramGuestSessionsForTest,
  saveTelegramGuestSession,
} from './guestSession';

const redisState = vi.hoisted(() => ({
  client: { get: vi.fn(), set: vi.fn() },
  enabled: false,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => (redisState.enabled ? redisState.client : null),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetTelegramGuestSessionsForTest();
});

describe('telegram guest session (memory fallback)', () => {
  beforeEach(() => {
    redisState.enabled = false;
  });

  it('round-trips a session when Redis is unavailable', async () => {
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10'),
    ).resolves.toMatchObject({
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });
  });

  it('stamps every save with a write timestamp', async () => {
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
    });

    const session = await getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10');
    expect(session?.guestQueryId).toBe('gq-1');
    expect(session?.savedAt).toEqual(expect.any(Number));
  });

  it('does not replace an existing outbound session during initialization', async () => {
    const threadId = 'telegram:guest:-1:message:10';
    await saveTelegramGuestSession('bot-1', threadId, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'reply',
      mediaType: 'photo',
    });

    await initializeTelegramGuestSession('bot-1', threadId, {
      guestQueryId: 'gq-1',
      locale: 'zh-CN',
    });

    await expect(getTelegramGuestSession('bot-1', threadId)).resolves.toMatchObject({
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'reply',
      mediaType: 'photo',
    });
  });

  it('isolates sessions by bot and guest invocation', async () => {
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'bot-1-query-10',
    });
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:11', {
      guestQueryId: 'bot-1-query-11',
    });
    await saveTelegramGuestSession('bot-2', 'telegram:guest:-1:message:10', {
      guestQueryId: 'bot-2-query-10',
    });

    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10'),
    ).resolves.toMatchObject({ guestQueryId: 'bot-1-query-10' });
    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:11'),
    ).resolves.toMatchObject({ guestQueryId: 'bot-1-query-11' });
    await expect(
      getTelegramGuestSession('bot-2', 'telegram:guest:-1:message:10'),
    ).resolves.toMatchObject({ guestQueryId: 'bot-2-query-10' });
  });

  it('evicts expired sessions when later invocations write to memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'expired',
    });

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:11', {
      guestQueryId: 'current',
    });

    expect(getTelegramGuestSessionMemorySizeForTest()).toBe(1);
    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10'),
    ).resolves.toBeUndefined();
  });
});

describe('telegram guest session (Redis-backed)', () => {
  const redis = redisState.client;
  const store = new Map<string, string>();

  beforeEach(() => {
    redisState.enabled = true;
    store.clear();
    redis.get.mockImplementation(async (key: string) => store.get(key) ?? null);
    redis.set.mockImplementation(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
  });

  afterEach(() => {
    redis.get.mockReset();
    redis.set.mockReset();
  });

  it('serves the Redis copy once memory is gone (webhook -> callback hop)', async () => {
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });
    // Simulate the callback isolate: fresh process, no in-memory state.
    resetTelegramGuestSessionsForTest();

    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10'),
    ).resolves.toMatchObject({ guestQueryId: 'gq-1', inlineMessageId: 'inline-1' });
  });

  it('atomically initializes without replacing an existing Redis session', async () => {
    const threadId = 'telegram:guest:-1:message:10';
    await saveTelegramGuestSession('bot-1', threadId, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      mediaType: 'photo',
    });
    resetTelegramGuestSessionsForTest();

    await initializeTelegramGuestSession('bot-1', threadId, {
      guestQueryId: 'gq-1',
      locale: 'zh-CN',
    });

    expect(redis.set).toHaveBeenLastCalledWith(
      'bot:telegram-guest:bot-1:telegram:guest:-1:message:10',
      expect.any(String),
      'EX',
      30 * 60,
      'NX',
    );
    await expect(getTelegramGuestSession('bot-1', threadId)).resolves.toMatchObject({
      inlineMessageId: 'inline-1',
      mediaType: 'photo',
    });
  });

  it('prefers the newer in-memory session over stale Redis after a failed set', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-old',
      lastText: 'old',
    });

    // The newer write fails to reach Redis, leaving the stale copy behind.
    vi.advanceTimersByTime(1000);
    redis.set.mockRejectedValueOnce(new Error('redis connection lost'));
    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-new',
      lastText: 'new',
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('failed to persist Telegram guest session'),
      expect.any(Error),
    );

    const session = await getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10');
    expect(session).toMatchObject({ inlineMessageId: 'inline-new', lastText: 'new' });
  });

  it('lets a newer Redis copy win over older memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-old',
    });

    // Another process writes a newer session to Redis after our last local save.
    vi.advanceTimersByTime(1000);
    const key = 'bot:telegram-guest:bot-1:telegram:guest:-1:message:10';
    store.set(
      key,
      JSON.stringify({
        guestQueryId: 'gq-1',
        inlineMessageId: 'inline-remote',
        savedAt: Date.now(),
      }),
    );

    await expect(
      getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10'),
    ).resolves.toMatchObject({ inlineMessageId: 'inline-remote' });
  });

  it('falls back to memory and logs loudly when the Redis read fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await saveTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10', {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    redis.get.mockRejectedValueOnce(new Error('redis read timeout'));
    const session = await getTelegramGuestSession('bot-1', 'telegram:guest:-1:message:10');
    expect(session).toMatchObject({ inlineMessageId: 'inline-1' });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('failed to read Telegram guest session'),
      expect.any(Error),
    );
  });
});
