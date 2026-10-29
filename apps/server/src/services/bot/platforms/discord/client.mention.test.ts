import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordClientFactory } from './client';

/**
 * Drives the adapter `DiscordClient` really builds through the real `chat`
 * dispatcher. chat-sdk also detects mentions from `@<adapter.userName>` in the
 * text, and `@chat-adapter/discord` defaults that name to "bot" — so a literal
 * "@bot" in a message (another bot's reply quoting a task title) woke every
 * Discord bot in the thread at once.
 */

const APPLICATION_ID = '111111111111111111';
const OTHER_BOT_ID = '444444444444444444';

const createMemoryState = () => {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const subscribed = new Set<string>();
  return {
    acquireLock: async (threadId: string) => ({
      expiresAt: Number.MAX_SAFE_INTEGER,
      threadId,
      token: 'token',
    }),
    appendToList: async (key: string, value: unknown) => {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
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
    getList: async (key: string) => lists.get(key) ?? [],
    isSubscribed: async (threadId: string) => subscribed.has(threadId),
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
    subscribe: async (threadId: string) => {
      subscribed.add(threadId);
    },
    unsubscribe: async (threadId: string) => {
      subscribed.delete(threadId);
    },
  };
};

const createBot = async () => {
  const client = new DiscordClientFactory().createClient(
    {
      applicationId: APPLICATION_ID,
      credentials: { botToken: 'bot-token', publicKey: 'a'.repeat(64) },
      platform: 'discord',
      settings: {},
    },
    {},
  );
  const chatBot = new Chat({
    adapters: client.createAdapter(),
    state: createMemoryState(),
    userName: `lobehub-bot-${APPLICATION_ID}`,
  } as any);
  const mentions: string[] = [];
  chatBot.onNewMention(async (_thread, message) => {
    mentions.push(message.text);
  });
  await chatBot.initialize();
  const adapter = (chatBot as any).adapters.get('discord');
  return { adapter, mentions };
};

/** A forwarded MESSAGE_CREATE from another bot inside a guild thread. */
const threadMessageEvent = (content: string, mentions: { id: string }[] = []) => ({
  data: {
    attachments: [],
    author: {
      bot: true,
      discriminator: '0',
      global_name: 'ShadowJianXu',
      id: OTHER_BOT_ID,
      username: 'ShadowJianXu',
    },
    channel_id: '555555555555555555',
    content,
    embeds: [],
    guild_id: '666666666666666666',
    // Unique per call — chat-sdk dedupes by message id.
    id: `9900000${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`,
    mention_roles: [],
    mentions,
    thread: { id: '555555555555555555', parent_id: '777777777777777777' },
    timestamp: new Date().toISOString(),
  },
  timestamp: 1_786_000_000_000,
  type: 'GATEWAY_MESSAGE_CREATE',
});

describe('DiscordClient adapter mention detection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not treat a literal "@bot" in the text as a mention of this bot', async () => {
    const { adapter, mentions } = await createBot();

    await adapter.handleForwardedGatewayEvent(
      threadMessageEvent('- **T-961** Bot：用户 @bot 但没有访问权限时识别并提示'),
    );

    expect(mentions).toHaveLength(0);
  });

  it('still routes a real Discord mention of this bot to onNewMention', async () => {
    const { adapter, mentions } = await createBot();

    await adapter.handleForwardedGatewayEvent(
      threadMessageEvent(`<@${APPLICATION_ID}> 看一下`, [{ id: APPLICATION_ID }]),
    );

    expect(mentions).toHaveLength(1);
  });
});
