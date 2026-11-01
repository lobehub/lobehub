// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscordApi } from './api';

const mocks = vi.hoisted(() => ({
  redisAvailable: true,
  set: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () =>
    mocks.redisAvailable
      ? {
          get: async (key: string) => mocks.store.get(key) ?? null,
          set: async (key: string, value: string, ...ttl: unknown[]) => {
            mocks.set(key, value, ...ttl);
            mocks.store.set(key, value);
          },
        }
      : null,
}));

const { clearDiscordChatCompositionMemoryCache, isSoloDiscordBotThread } =
  await import('./chatComposition');

const human = (id: string) => ({ member: { user: { bot: false, id } } });
const bot = (id: string) => ({ member: { user: { bot: true, id } } });
const makeApi = (listThreadMembers: DiscordApi['listThreadMembers']) => ({ listThreadMembers });

describe('isSoloDiscordBotThread', () => {
  beforeEach(() => {
    mocks.redisAvailable = true;
    mocks.store.clear();
    mocks.set.mockClear();
    clearDiscordChatCompositionMemoryCache();
  });

  afterEach(() => vi.useRealTimers());

  it('treats one human plus the current bot as solo', async () => {
    const listThreadMembers = vi.fn().mockResolvedValue([human('alice'), bot('app-123')]);

    await expect(
      isSoloDiscordBotThread(makeApi(listThreadMembers), 'app-123', 'thread-1'),
    ).resolves.toBe(true);
  });

  it('requires a mention when a second human is a member, even if they never spoke', async () => {
    const listThreadMembers = vi
      .fn()
      .mockResolvedValue([human('alice'), human('bob'), bot('app-123')]);

    await expect(
      isSoloDiscordBotThread(makeApi(listThreadMembers), 'app-123', 'thread-1'),
    ).resolves.toBe(false);
  });

  it('requires a mention when another bot is in the thread', async () => {
    const listThreadMembers = vi
      .fn()
      .mockResolvedValue([human('alice'), bot('app-123'), bot('another-bot')]);

    await expect(
      isSoloDiscordBotThread(makeApi(listThreadMembers), 'app-123', 'thread-1'),
    ).resolves.toBe(false);
  });

  it('fails closed when the current bot or expanded member data is missing', async () => {
    const missingOwnBot = vi.fn().mockResolvedValue([human('alice'), bot('another-bot')]);
    const missingMember = vi.fn().mockResolvedValue([human('alice'), { user_id: 'app-123' }]);

    await expect(
      isSoloDiscordBotThread(makeApi(missingOwnBot), 'app-123', 'thread-no-own-bot'),
    ).resolves.toBe(false);
    await expect(
      isSoloDiscordBotThread(makeApi(missingMember), 'app-123', 'thread-no-member'),
    ).resolves.toBe(false);
  });

  it('fails closed when Discord rejects the member lookup', async () => {
    const listThreadMembers = vi.fn().mockRejectedValue(new Error('Missing Access'));

    await expect(
      isSoloDiscordBotThread(makeApi(listThreadMembers), 'app-123', 'thread-1'),
    ).resolves.toBe(false);
  });

  it('caches each thread verdict and gives solo a shorter TTL than shared', async () => {
    const listThreadMembers = vi
      .fn()
      .mockResolvedValueOnce([human('alice'), bot('app-123')])
      .mockResolvedValueOnce([human('alice'), bot('app-123'), bot('another-bot')]);
    const api = makeApi(listThreadMembers);

    await isSoloDiscordBotThread(api, 'app-123', 'thread-solo');
    await isSoloDiscordBotThread(api, 'app-123', 'thread-shared');
    await isSoloDiscordBotThread(api, 'app-123', 'thread-solo');

    expect(listThreadMembers).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledWith(
      'bot:discord-thread-solo:app-123:thread-solo',
      '1',
      'EX',
      60,
    );
    expect(mocks.set).toHaveBeenCalledWith(
      'bot:discord-thread-solo:app-123:thread-shared',
      '0',
      'EX',
      600,
    );
    if (process.env.T500_ACCEPTANCE_CAPTURE === '1') {
      console.log(
        'T500_ACCEPTANCE:cache',
        JSON.stringify({
          listCalls: listThreadMembers.mock.calls.length,
          writes: mocks.set.mock.calls,
        }),
      );
    }
  });

  it('isolates membership verdicts between threads', async () => {
    const evaluate = async (threadId: string, members: unknown[] | Error) => {
      const listThreadMembers =
        members instanceof Error
          ? vi.fn().mockRejectedValue(members)
          : vi.fn().mockResolvedValue(members);
      const result = await isSoloDiscordBotThread(makeApi(listThreadMembers), 'app-123', threadId);
      return { listCalls: listThreadMembers.mock.calls.length, result };
    };

    const observations = {
      apiError: await evaluate('matrix-api-error', new Error('Missing Access')),
      missingOwnBot: await evaluate('matrix-missing-own', [human('alice'), bot('another-bot')]),
      otherBot: await evaluate('matrix-other-bot', [
        human('alice'),
        bot('app-123'),
        bot('another-bot'),
      ]),
      secondHuman: await evaluate('matrix-second-human', [
        human('alice'),
        human('bob'),
        bot('app-123'),
      ]),
      solo: await evaluate('matrix-solo', [human('alice'), bot('app-123')]),
    };

    expect(observations).toEqual({
      apiError: { listCalls: 1, result: false },
      missingOwnBot: { listCalls: 1, result: false },
      otherBot: { listCalls: 1, result: false },
      secondHuman: { listCalls: 1, result: false },
      solo: { listCalls: 1, result: true },
    });
    if (process.env.T500_ACCEPTANCE_CAPTURE === '1') {
      console.log('T500_ACCEPTANCE:membership-matrix', JSON.stringify(observations));
    }
  });

  describe('without Redis', () => {
    beforeEach(() => {
      mocks.redisAvailable = false;
    });

    it('uses the bounded memory cache and re-checks after the solo TTL', async () => {
      vi.useFakeTimers();
      const listThreadMembers = vi
        .fn()
        .mockResolvedValueOnce([human('alice'), bot('app-123')])
        .mockResolvedValueOnce([human('alice'), human('bob'), bot('app-123')]);
      const api = makeApi(listThreadMembers);

      await expect(isSoloDiscordBotThread(api, 'app-123', 'thread-1')).resolves.toBe(true);
      await expect(isSoloDiscordBotThread(api, 'app-123', 'thread-1')).resolves.toBe(true);
      vi.advanceTimersByTime(61 * 1000);
      await expect(isSoloDiscordBotThread(api, 'app-123', 'thread-1')).resolves.toBe(false);

      expect(listThreadMembers).toHaveBeenCalledTimes(2);
    });
  });
});
