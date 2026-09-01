import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getTelegramDraftSession,
  resetTelegramDraftSessionsForTest,
  saveTelegramDraftSession,
} from './draftSession';
import { LobeTelegramAdapter } from './guestAdapter';
import {
  getTelegramGuestSession,
  resetTelegramGuestSessionsForTest,
  saveTelegramGuestSession,
} from './guestSession';
import { isGuestTelegramThreadId } from './threadId';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const GET_ME_RESPONSE = () =>
  new Response(
    JSON.stringify({
      ok: true,
      result: { first_name: 'Bot', id: 999, is_bot: true, username: 'mybot' },
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 },
  );

const mockGetMe = () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(GET_ME_RESPONSE());
};

const processUpdate = (adapter: LobeTelegramAdapter, update: unknown) => {
  (adapter as unknown as { processUpdate: (value: unknown) => void }).processUpdate(update);
};

const createGuestAdapter = (
  sessionScope: string,
  extra?: Partial<ConstructorParameters<typeof LobeTelegramAdapter>[0]>,
) =>
  new LobeTelegramAdapter(
    {
      allowUnverifiedWebhooks: true,
      botToken: '1:token',
      userName: 'mybot',
      ...extra,
    },
    sessionScope,
  );

const createMemoryState = () => {
  const values = new Map<string, unknown>();
  return {
    acquireLock: async (threadId: string) => ({
      expiresAt: Number.MAX_SAFE_INTEGER,
      threadId,
      token: 'token',
    }),
    appendToList: async () => {},
    connect: async () => {},
    delete: async (key: string) => {
      values.delete(key);
    },
    dequeue: async () => null,
    disconnect: async () => {},
    enqueue: async () => 1,
    extendLock: async () => true,
    forceReleaseLock: async () => {},
    get: async (key: string) => values.get(key) ?? null,
    getList: async () => [],
    isSubscribed: async () => false,
    queueDepth: async () => 0,
    releaseLock: async () => {},
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    setIfNotExists: async (key: string, value: unknown) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    subscribe: async () => {},
    unsubscribe: async () => {},
  };
};

afterEach(() => {
  resetTelegramDraftSessionsForTest();
  resetTelegramGuestSessionsForTest();
  vi.restoreAllMocks();
});

describe('LobeTelegramAdapter Guest Mode', () => {
  it('exposes processUpdate so Guest Mode can subclass the Chat SDK adapter', () => {
    expect('processUpdate' in LobeTelegramAdapter.prototype).toBe(true);
  });

  it('treats guest thread ids as non-DM', () => {
    const adapter = createGuestAdapter('bot-1');
    expect(adapter.isDM('telegram:guest:-100123')).toBe(false);
    expect(isGuestTelegramThreadId('telegram:guest:-100123')).toBe(true);
  });

  it('keeps guest and member channels in separate namespaces', () => {
    const adapter = createGuestAdapter('bot-1');

    const firstGuest = adapter.channelIdFromThreadId('telegram:guest:-100123:bot:bot-1:message:11');
    const secondGuest = adapter.channelIdFromThreadId(
      'telegram:guest:-100123:bot:bot-1:message:12',
    );
    expect(firstGuest).toBe('telegram:guest:-100123:bot:bot-1:message:11');
    expect(secondGuest).toBe('telegram:guest:-100123:bot:bot-1:message:12');
    expect(firstGuest).not.toBe(secondGuest);
    expect(adapter.channelIdFromThreadId('telegram:-100123')).toBe('telegram:-100123');
  });

  it('routes guest_message updates as mentions on a guest thread', async () => {
    mockGetMe();
    const adapter = createGuestAdapter('bot-1');

    const mentions: Array<{ id: string; isMention?: boolean; raw?: unknown; threadId: string }> =
      [];
    const bot = new Chat({
      adapters: { telegram: adapter },
      state: createMemoryState() as never,
      userName: 'mybot',
    });
    bot.onNewMention(async (thread, message) => {
      mentions.push({
        id: message.id,
        isMention: message.isMention,
        raw: message.raw,
        threadId: thread.id,
      });
    });
    await bot.initialize();

    processUpdate(adapter, {
      guest_message: {
        chat: { id: -100123, title: 'Room', type: 'supergroup' },
        date: 1,
        from: { first_name: 'Ada', id: 7, is_bot: false, username: 'ada' },
        guest_bot_caller_user: { first_name: 'Ada', id: 7, is_bot: false, username: 'ada' },
        guest_query_id: 'gq-42',
        message_id: 11,
        text: '@mybot hello',
      },
      update_id: 1,
    });

    await vi.waitFor(() => {
      expect(mentions.length).toBeGreaterThan(0);
    });

    expect(mentions[0]?.threadId).toBe('telegram:guest:-100123:bot:bot-1:message:11');
    expect(mentions[0]?.id).toBe('guest:bot-1:-100123:11');
    expect(mentions[0]?.isMention).toBe(true);
    expect((mentions[0]?.raw as { guest_query_id?: string } | undefined)?.guest_query_id).toBe(
      'gq-42',
    );
  });

  it('does not dedupe the same Telegram message across guest bots', async () => {
    mockGetMe();

    const state = createMemoryState() as never;
    const mentions: Array<{ id: string; threadId: string }> = [];
    const createBot = async (sessionScope: string) => {
      const adapter = createGuestAdapter(sessionScope);
      const bot = new Chat({
        adapters: { telegram: adapter },
        state,
        userName: 'mybot',
      });
      bot.onNewMention(async (thread, message) => {
        mentions.push({ id: message.id, threadId: thread.id });
      });
      await bot.initialize();
      return adapter;
    };

    const firstAdapter = await createBot('bot-1');
    const secondAdapter = await createBot('bot-2');
    const update = {
      guest_message: {
        chat: { id: -100123, title: 'Room', type: 'supergroup' },
        date: 1,
        guest_bot_caller_user: { first_name: 'Ada', id: 7, is_bot: false },
        guest_query_id: 'gq-42',
        message_id: 11,
        text: 'hello',
      },
      update_id: 1,
    };

    processUpdate(firstAdapter, update);
    processUpdate(secondAdapter, update);

    await vi.waitFor(() => {
      expect(mentions).toHaveLength(2);
    });
    expect(mentions).toEqual(
      expect.arrayContaining([
        {
          id: 'guest:bot-1:-100123:11',
          threadId: 'telegram:guest:-100123:bot:bot-1:message:11',
        },
        {
          id: 'guest:bot-2:-100123:11',
          threadId: 'telegram:guest:-100123:bot:bot-2:message:11',
        },
      ]),
    );
  });

  it('preserves outbound session state when Telegram redelivers a guest update', async () => {
    mockGetMe();
    const adapter = createGuestAdapter('bot-1');
    const mentions: string[] = [];
    const bot = new Chat({
      adapters: { telegram: adapter },
      state: createMemoryState() as never,
      userName: 'mybot',
    });
    bot.onNewMention(async (_thread, message) => {
      mentions.push(message.id);
    });
    await bot.initialize();

    const update = {
      guest_message: {
        chat: { id: -100123, title: 'Room', type: 'supergroup' },
        date: 1,
        guest_bot_caller_user: { first_name: 'Ada', id: 7, is_bot: false },
        guest_query_id: 'gq-duplicate',
        message_id: 14,
        text: '@mybot hello',
      },
      update_id: 4,
    };
    const threadId = 'telegram:guest:-100123:bot:bot-1:message:14';

    processUpdate(adapter, update);
    await vi.waitFor(() => {
      expect(mentions).toHaveLength(1);
    });
    await saveTelegramGuestSession('bot-1', threadId, {
      guestQueryId: 'gq-duplicate',
      inlineMessageId: 'inline-14',
      lastText: 'rich reply',
    });

    processUpdate(adapter, update);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mentions).toHaveLength(1);
    await expect(getTelegramGuestSession('bot-1', threadId)).resolves.toMatchObject({
      inlineMessageId: 'inline-14',
      lastText: 'rich reply',
    });
  });

  it('rejects guest updates from users outside the adapter allowlist', async () => {
    mockGetMe();
    const adapter = createGuestAdapter('bot-1', { allowedUserIds: ['42'] });
    const mentions: string[] = [];
    const bot = new Chat({
      adapters: { telegram: adapter },
      state: createMemoryState() as never,
      userName: 'mybot',
    });
    bot.onNewMention(async (_thread, message) => {
      mentions.push(message.id);
    });
    await bot.initialize();

    processUpdate(adapter, {
      guest_message: {
        chat: { id: -100123, type: 'supergroup' },
        guest_bot_caller_user: { first_name: 'Blocked', id: 7, is_bot: false },
        guest_query_id: 'gq-blocked',
        message_id: 12,
        text: 'hello',
      },
      update_id: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mentions).toEqual([]);
  });

  it('records a scoped early stop request for a native draft', async () => {
    const adapter = createGuestAdapter('bot-1');
    await saveTelegramDraftSession({
      applicationId: 'bot-1',
      draftId: 42,
      platformThreadId: 'telegram:7',
      userId: 'user-1',
    });

    processUpdate(adapter, {
      stopped_message_generation: {
        chat: { id: 7, type: 'private' },
        draft_id: 42,
      },
      update_id: 5,
    });

    await vi.waitFor(async () => {
      await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
        stopRequested: true,
      });
    });
  });
});
