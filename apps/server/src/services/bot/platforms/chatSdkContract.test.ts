import { createDiscordAdapter } from '@chat-adapter/discord';
import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patchDiscordForwardedInteractions } from './discord/patch';

/**
 * Drift guards for the `chat` / `@chat-adapter/*` contracts our bot code leans
 * on. These packages float on a caret range with no committed lockfile — that
 * is deliberate, so we stay on current library APIs — which means an upstream
 * change reaches production without passing through any commit of ours.
 *
 * Two safety nets already exist and are NOT duplicated here:
 *   - `tsgo` covers every typed surface, including the five in-house adapters
 *     that `implements Adapter<…>`;
 *   - each patch has unit tests for its own branching logic.
 *
 * What neither catches — and what has let Discord slash-command regressions
 * slip through unnoticed — is the class of coupling TypeScript cannot see:
 *   1. members reached through an `any` cast (`adapters.get('discord')`);
 *   2. call shapes of `protected` methods we monkey-patch, which semver does
 *      not protect;
 *   3. runtime BEHAVIOUR our routing depends on but never asserts — "a DM
 *      arrives with isMention true", "posting inside a slash context edits the
 *      deferred reply", "the thrown API error still embeds Discord's JSON".
 *
 * So every test below drives the REAL packages. A mocked adapter would keep
 * passing against a signature that no longer exists — which is exactly how the
 * regression shipped.
 */

const APPLICATION_ID = '111111111111111111';
const DM_CHANNEL_ID = '333333333333333333';
const USER_ID = '222222222222222222';

/** Minimal in-memory `StateAdapter`; production wires ioredis instead. */
const createMemoryState = () => {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const subscribed = new Set<string>();
  const queues = new Map<string, unknown[]>();
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
    dequeue: async (threadId: string) => queues.get(threadId)?.shift() ?? null,
    disconnect: async () => {},
    enqueue: async (threadId: string, entry: unknown) => {
      const queue = queues.get(threadId) ?? [];
      queue.push(entry);
      queues.set(threadId, queue);
      return queue.length;
    },
    extendLock: async () => true,
    forceReleaseLock: async () => {},
    get: async (key: string) => values.get(key) ?? null,
    getList: async (key: string) => lists.get(key) ?? [],
    isSubscribed: async (threadId: string) => subscribed.has(threadId),
    queueDepth: async (threadId: string) => queues.get(threadId)?.length ?? 0,
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

const createRealBot = ({ patch = true }: { patch?: boolean } = {}) => {
  const chatBot = new Chat({
    adapters: {
      discord: createDiscordAdapter({
        applicationId: APPLICATION_ID,
        botToken: 'bot-token',
        publicKey: 'a'.repeat(64),
      }),
    },
    state: createMemoryState(),
    userName: 'lobehub',
  } as any);

  if (patch) patchDiscordForwardedInteractions(chatBot);
  return chatBot;
};

/** A DM-shaped forwarded MESSAGE_CREATE: no `guild_id`, channel type 1. */
const dmMessageEvent = (content: string) => ({
  data: {
    attachments: [],
    author: {
      bot: false,
      discriminator: '0',
      global_name: 'JianXu',
      id: USER_ID,
      username: 'rdmclin2',
    },
    channel_id: DM_CHANNEL_ID,
    channel_type: 1,
    content,
    embeds: [],
    // Unique per call — chat-sdk dedupes by message id.
    id: `9900000${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`,
    mention_roles: [],
    mentions: [],
    timestamp: new Date().toISOString(),
  },
  timestamp: 1_786_000_000_000,
  type: 'GATEWAY_MESSAGE_CREATE',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat-sdk contract · adapter registry', () => {
  it('exposes adapters through an `adapters` Map keyed by platform id', () => {
    // `DiscordClient` / `QQClient` / both Discord patches all reach the adapter
    // this way, through an `any` cast that hides a rename from tsgo:
    //   (bot as any).adapters.get('discord')
    const chatBot = createRealBot({ patch: false });
    const registry = (chatBot as any).adapters;

    expect(registry).toBeInstanceOf(Map);
    expect(registry.get('discord')).toBeDefined();
  });
});

describe('chat-sdk contract · Discord adapter members we reach into', () => {
  // Every entry is a member some LobeHub code calls on the adapter instance
  // rather than through the public Chat API. Removing or renaming any of them
  // upstream is a silent break, so they are pinned by name and arity.
  //
  // arity = declared parameter count (optional/rest params are excluded by JS,
  // so this is a floor, not an exact signature check).
  const REACHED_MEMBERS: { arity?: number; by: string; name: string }[] = [
    { by: 'patchDiscordForwardedInteractions', name: 'handleForwardedGatewayEvent' },
    { by: 'patchDiscordForwardedInteractions', name: 'discordInteractionFetch' },
    { arity: 1, by: 'patchDiscordForwardedInteractions', name: 'getApplicationCommandContext' },
    { arity: 1, by: 'patchDiscordForwardedInteractions', name: 'getInteractionFlags' },
    { by: 'patchDiscordForwardedInteractions', name: 'handleApplicationCommandInteraction' },
    { by: 'patchDiscordForwardedInteractions', name: 'handleComponentInteraction' },
    { by: 'DiscordClient.start', name: 'startGatewayListener' },
    { arity: 1, by: 'Chat message dispatch (DM detection)', name: 'isDM' },
  ];

  it.each(REACHED_MEMBERS)('$name is a function (used by $by)', ({ arity, name }) => {
    const adapter = (createRealBot({ patch: false }) as any).adapters.get('discord');

    expect(typeof adapter[name], `adapter.${name} is missing`).toBe('function');
    if (arity !== undefined) expect(adapter[name].length).toBe(arity);
  });

  it('keeps `handleApplicationCommandInteraction` on the context call shape', () => {
    // The 4.32.0 signature change — (interaction, options) → (context, flags,
    // options) — is what left every Discord slash command spinning on
    // "Thinking…". `getApplicationCommandContext` is the marker the patch
    // probes for, so its presence and this method's arity must move together.
    const adapter = (createRealBot({ patch: false }) as any).adapters.get('discord');

    expect(typeof adapter.getApplicationCommandContext).toBe('function');
    expect(adapter.handleApplicationCommandInteraction.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a command context carrying the parsed command and the raw interaction', () => {
    const adapter = (createRealBot({ patch: false }) as any).adapters.get('discord');

    const context = adapter.getApplicationCommandContext({
      channel: { id: DM_CHANNEL_ID, type: 1 },
      channel_id: DM_CHANNEL_ID,
      data: { name: 'agents', options: [] },
      id: '555555555555555555',
      token: 'interaction-token',
      type: 2,
      user: { global_name: 'JianXu', id: USER_ID, username: 'rdmclin2' },
    });

    // `handleApplicationCommandInteraction` destructures exactly these; a
    // reshape here is what produced `undefined.token` in production.
    expect(context).toMatchObject({ command: '/agents' });
    expect(context.interaction.token).toBe('interaction-token');
    expect(context.user.id).toBe(USER_ID);
    expect(typeof context.channelId).toBe('string');
  });
});

describe('chat-sdk contract · DM routing', () => {
  // `MessengerRouter.registerHandlers` deliberately does NOT register
  // `onDirectMessage`, because chat-sdk short-circuits DM dispatch when one
  // exists — which would kill the subscription routing that lets follow-ups
  // reuse the cached topicId. Both halves of that assumption are asserted
  // here; a comment cannot fail CI.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  });

  it('delivers an unsubscribed DM to onNewMention with isMention forced true', async () => {
    const chatBot = createRealBot();
    const seen: { isMention?: boolean }[] = [];
    chatBot.onNewMention(async (_thread, message) => {
      seen.push({ isMention: (message as { isMention?: boolean }).isMention });
    });
    await chatBot.initialize();

    const adapter = (chatBot as any).adapters.get('discord');
    await adapter.handleForwardedGatewayEvent(dmMessageEvent('hi'));

    expect(seen).toHaveLength(1);
    // Without this, a first-touch DM never opens a topic.
    expect(seen[0].isMention).toBe(true);
  });

  it('short-circuits away from onNewMention as soon as onDirectMessage exists', async () => {
    const chatBot = createRealBot();
    const mentions: unknown[] = [];
    const directMessages: unknown[] = [];
    chatBot.onNewMention(async () => {
      mentions.push(1);
    });
    chatBot.onDirectMessage(async () => {
      directMessages.push(1);
    });
    await chatBot.initialize();

    const adapter = (chatBot as any).adapters.get('discord');
    await adapter.handleForwardedGatewayEvent(dmMessageEvent('hi'));

    // If this ever flips, registering `onDirectMessage` becomes safe — and
    // until it does, MessengerRouter must keep leaving it unregistered.
    expect(directMessages).toHaveLength(1);
    expect(mentions).toHaveLength(0);
  });
});

describe('chat-sdk contract · Discord thread recovery', () => {
  /** Discord's "a thread has already been created for this message". */
  const stubAlreadyCreated = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/threads')
          ? new Response(
              JSON.stringify({
                code: 160_004,
                message: 'A thread has already been created for this message',
              }),
              { status: 400 },
            )
          : new Response(JSON.stringify({ id: 'message-1', thread: { id: 'thread-1' } }), {
              status: 200,
            }),
      ),
    );

  // LobeHub used to carry `patchDiscordThreadRecovery` for this: it caught the
  // thrown 160004 and re-resolved the thread via `GET /channels/:id/messages/:id`.
  // `@chat-adapter/discord` adopted the same recovery in 4.24.0 — returning
  // `{ id: messageId }`, which is correct because a thread created from a
  // message shares its starter message's id — so the patch had been dead code
  // for months and was removed. We now depend on the adapter for it, and these
  // tests are what makes that dependency explicit instead of implicit.
  it('recovers instead of throwing when the message already has a thread', async () => {
    stubAlreadyCreated();

    const chatBot = createRealBot();
    await chatBot.initialize();
    const adapter = (chatBot as any).adapters.get('discord');

    // If this ever throws again, replies stop being delivered into the thread
    // and `patchDiscordThreadRecovery` has to come back.
    await expect(adapter.createDiscordThread(DM_CHANNEL_ID, 'message-1')).resolves.toMatchObject({
      id: 'message-1',
    });
  });

  it('still rethrows Discord errors that are not "thread already created"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 50_013, message: 'Missing Permissions' }), {
            status: 403,
          }),
      ),
    );

    const chatBot = createRealBot();
    await chatBot.initialize();
    const adapter = (chatBot as any).adapters.get('discord');

    await expect(adapter.createDiscordThread(DM_CHANNEL_ID, 'message-1')).rejects.toThrow();
  });
});
