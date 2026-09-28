// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisAvailable: true,
  set: vi.fn(),
  store: new Map<string, string>(),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () =>
    mocks.redisAvailable
      ? {
          del: async (key: string) => mocks.store.delete(key),
          get: async (key: string) => mocks.store.get(key) ?? null,
          set: async (key: string, value: string, ...ttl: unknown[]) => {
            mocks.set(key, value, ...ttl);
            mocks.store.set(key, value);
          },
        }
      : null,
}));

const { clearChatCompositionMemoryCache, isSoloBotChat } = await import('./chatComposition');

const makeApi = (getChatInfo: ReturnType<typeof vi.fn>) => ({ getChatInfo }) as any;

describe('isSoloBotChat', () => {
  beforeEach(() => {
    mocks.redisAvailable = true;
    mocks.store.clear();
    mocks.set.mockClear();
    clearChatCompositionMemoryCache();
  });
  afterEach(() => vi.useRealTimers());

  it('treats one user + one bot as the bot private conversation', async () => {
    // Feishu reports both counts as strings.
    const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '1', user_count: '1' });

    await expect(isSoloBotChat(makeApi(getChatInfo), 'cli_app', 'oc_1')).resolves.toBe(true);
  });

  it('requires an @mention once a second human is a MEMBER, even if they never spoke', async () => {
    // The regression: the old speaker-count heuristic read this group as
    // private because only one of the two members had ever talked.
    const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '1', user_count: '2' });

    await expect(isSoloBotChat(makeApi(getChatInfo), 'cli_app', 'oc_1')).resolves.toBe(false);
  });

  it('requires an @mention when another bot is in the chat', async () => {
    // One human, two bots — a message @-ing the other bot must not wake this one.
    const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '2', user_count: '1' });

    await expect(isSoloBotChat(makeApi(getChatInfo), 'cli_app', 'oc_1')).resolves.toBe(false);
  });

  it('fails closed when the chat cannot be inspected', async () => {
    // e.g. the app lacks `im:chat:readonly`. Staying quiet beats talking over a group.
    const getChatInfo = vi.fn().mockRejectedValue(new Error('230027 Permission denied'));

    await expect(isSoloBotChat(makeApi(getChatInfo), 'cli_app', 'oc_1')).resolves.toBe(false);
  });

  it('caches the verdict instead of asking once per inbound message', async () => {
    const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '1', user_count: '1' });
    const api = makeApi(getChatInfo);

    await isSoloBotChat(api, 'cli_app', 'oc_1');
    await isSoloBotChat(api, 'cli_app', 'oc_1');

    expect(getChatInfo).toHaveBeenCalledTimes(1);
  });

  it('holds a solo verdict far shorter than a shared one, so a newly joined member is noticed', async () => {
    // A stale "solo" keeps the bot answering every message after someone joins;
    // a stale "shared" only delays dropping the @mention requirement.
    const api = makeApi(
      vi
        .fn()
        .mockResolvedValueOnce({ bot_count: '1', user_count: '1' })
        .mockResolvedValueOnce({ bot_count: '1', user_count: '3' }),
    );

    await isSoloBotChat(api, 'cli_app', 'oc_solo');
    await isSoloBotChat(api, 'cli_app', 'oc_team');

    const ttlOf = (chatId: string) =>
      mocks.set.mock.calls.find(([key]) => String(key).endsWith(chatId))!.at(-1);
    expect(ttlOf('oc_solo')).toBeLessThan(ttlOf('oc_team'));
    expect(ttlOf('oc_solo')).toBeLessThanOrEqual(60);
  });

  it('keys the cache per chat, so one group does not answer for another', async () => {
    const getChatInfo = vi
      .fn()
      .mockResolvedValueOnce({ bot_count: '1', user_count: '1' })
      .mockResolvedValueOnce({ bot_count: '1', user_count: '5' });
    const api = makeApi(getChatInfo);

    await expect(isSoloBotChat(api, 'cli_app', 'oc_solo')).resolves.toBe(true);
    await expect(isSoloBotChat(api, 'cli_app', 'oc_team')).resolves.toBe(false);
  });

  describe('without Redis', () => {
    beforeEach(() => {
      mocks.redisAvailable = false;
    });

    it('still answers from the real composition rather than refusing outright', async () => {
      const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '1', user_count: '1' });

      await expect(isSoloBotChat(makeApi(getChatInfo), 'cli_app', 'oc_1')).resolves.toBe(true);
    });

    it('caches in process memory instead of one Feishu request per inbound message', async () => {
      const getChatInfo = vi.fn().mockResolvedValue({ bot_count: '1', user_count: '4' });
      const api = makeApi(getChatInfo);

      await isSoloBotChat(api, 'cli_app', 'oc_1');
      await isSoloBotChat(api, 'cli_app', 'oc_1');
      await isSoloBotChat(api, 'cli_app', 'oc_1');

      expect(getChatInfo).toHaveBeenCalledTimes(1);
    });

    it('re-checks a solo verdict once its short TTL has elapsed', async () => {
      vi.useFakeTimers();
      const getChatInfo = vi
        .fn()
        .mockResolvedValueOnce({ bot_count: '1', user_count: '1' })
        .mockResolvedValueOnce({ bot_count: '1', user_count: '2' });
      const api = makeApi(getChatInfo);

      await expect(isSoloBotChat(api, 'cli_app', 'oc_1')).resolves.toBe(true);
      vi.advanceTimersByTime(61 * 1000);
      await expect(isSoloBotChat(api, 'cli_app', 'oc_1')).resolves.toBe(false);
      expect(getChatInfo).toHaveBeenCalledTimes(2);
    });
  });
});
