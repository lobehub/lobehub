import { createDiscordAdapter } from '@chat-adapter/discord';
import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { patchDiscordForwardedInteractions } from './forwardedInteractions';

describe('patchDiscordForwardedInteractions', () => {
  it('should ACK and dispatch forwarded slash commands', async () => {
    const originalHandleForwardedGatewayEvent = vi.fn();
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const handleApplicationCommandInteraction = vi.fn();
    const handleComponentInteraction = vi.fn();
    const getApplicationCommandContext = vi.fn().mockReturnValue({ command: '/start' });
    const getInteractionFlags = vi.fn().mockReturnValue(undefined);

    const adapter = {
      discordInteractionFetch,
      getApplicationCommandContext,
      getInteractionFlags,
      handleApplicationCommandInteraction,
      handleComponentInteraction,
      handleForwardedGatewayEvent: originalHandleForwardedGatewayEvent,
    };

    const chatBot = {
      adapters: new Map([['discord', adapter]]),
    } as any;

    patchDiscordForwardedInteractions(chatBot);

    const interaction = { id: 'interaction-1', token: 'token-1', type: 2 };
    const response = await adapter.handleForwardedGatewayEvent(
      { data: interaction, type: 'GATEWAY_INTERACTION_CREATE' },
      { foo: 'bar' },
    );

    expect(discordInteractionFetch).toHaveBeenCalledWith(
      '/interactions/interaction-1/token-1/callback',
      'POST',
      { type: 5 },
    );
    // The context — not the raw interaction — is what the adapter expects
    // since @chat-adapter/discord@4.32.0.
    expect(getApplicationCommandContext).toHaveBeenCalledWith(interaction);
    expect(handleApplicationCommandInteraction).toHaveBeenCalledWith(
      { command: '/start' },
      undefined,
      expect.objectContaining({ foo: 'bar', waitUntil: expect.any(Function) }),
    );
    expect(handleComponentInteraction).not.toHaveBeenCalled();
    expect(originalHandleForwardedGatewayEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should fold resolved ephemeral flags into the deferred response', async () => {
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const handleApplicationCommandInteraction = vi.fn();

    const adapter = {
      discordInteractionFetch,
      getApplicationCommandContext: vi.fn().mockReturnValue({ command: '/agents' }),
      getInteractionFlags: vi.fn().mockReturnValue(64),
      handleApplicationCommandInteraction,
      handleComponentInteraction: vi.fn(),
      handleForwardedGatewayEvent: vi.fn(),
    };

    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;
    patchDiscordForwardedInteractions(chatBot);

    await adapter.handleForwardedGatewayEvent({
      data: { id: 'interaction-3', token: 'token-3', type: 2 },
      type: 'GATEWAY_INTERACTION_CREATE',
    });

    expect(discordInteractionFetch).toHaveBeenCalledWith(
      '/interactions/interaction-3/token-3/callback',
      'POST',
      { data: { flags: 64 }, type: 5 },
    );
    expect(handleApplicationCommandInteraction).toHaveBeenCalledWith(
      { command: '/agents' },
      64,
      expect.any(Object),
    );
  });

  it('should await background work handed back through waitUntil before responding', async () => {
    let settle: (() => void) | undefined;
    const handlerDone = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let handlerFinished = false;

    const adapter = {
      discordInteractionFetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      getApplicationCommandContext: vi.fn().mockReturnValue({ command: '/new' }),
      getInteractionFlags: vi.fn().mockReturnValue(undefined),
      handleApplicationCommandInteraction: vi.fn((_ctx, _flags, options: any) => {
        options.waitUntil(handlerDone.then(() => (handlerFinished = true)));
      }),
      handleComponentInteraction: vi.fn(),
      handleForwardedGatewayEvent: vi.fn(),
    };

    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;
    patchDiscordForwardedInteractions(chatBot);

    const pending = adapter.handleForwardedGatewayEvent({
      data: { id: 'interaction-4', token: 'token-4', type: 2 },
      type: 'GATEWAY_INTERACTION_CREATE',
    });

    expect(handlerFinished).toBe(false);
    settle!();
    await pending;
    expect(handlerFinished).toBe(true);
  });

  it('should fall back to the legacy call shape when the adapter has no command context', async () => {
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const handleApplicationCommandInteraction = vi.fn();

    // Pre-4.32.0 adapters take the raw interaction and have no
    // `getApplicationCommandContext`.
    const adapter = {
      discordInteractionFetch,
      handleApplicationCommandInteraction,
      handleComponentInteraction: vi.fn(),
      handleForwardedGatewayEvent: vi.fn(),
    };

    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;
    patchDiscordForwardedInteractions(chatBot);

    const interaction = { id: 'interaction-5', token: 'token-5', type: 2 };
    await adapter.handleForwardedGatewayEvent(
      { data: interaction, type: 'GATEWAY_INTERACTION_CREATE' },
      undefined,
    );

    expect(handleApplicationCommandInteraction).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ waitUntil: expect.any(Function) }),
    );
  });

  it('should ACK and dispatch forwarded component interactions', async () => {
    const originalHandleForwardedGatewayEvent = vi.fn();
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const handleApplicationCommandInteraction = vi.fn();
    const handleComponentInteraction = vi.fn();

    const adapter = {
      discordInteractionFetch,
      getApplicationCommandContext: vi.fn(),
      getInteractionFlags: vi.fn(),
      handleApplicationCommandInteraction,
      handleComponentInteraction,
      handleForwardedGatewayEvent: originalHandleForwardedGatewayEvent,
    };

    const chatBot = {
      adapters: new Map([['discord', adapter]]),
    } as any;

    patchDiscordForwardedInteractions(chatBot);

    await adapter.handleForwardedGatewayEvent(
      {
        data: { id: 'interaction-2', token: 'token-2', type: 3 },
        type: 'GATEWAY_INTERACTION_CREATE',
      },
      { foo: 'bar' },
    );

    expect(discordInteractionFetch).toHaveBeenCalledWith(
      '/interactions/interaction-2/token-2/callback',
      'POST',
      { type: 6 },
    );
    expect(handleComponentInteraction).toHaveBeenCalledWith(
      { id: 'interaction-2', token: 'token-2', type: 3 },
      expect.objectContaining({ foo: 'bar', waitUntil: expect.any(Function) }),
    );
    // Component interactions never went through the context indirection.
    expect(adapter.getApplicationCommandContext).not.toHaveBeenCalled();
    expect(handleApplicationCommandInteraction).not.toHaveBeenCalled();
    expect(originalHandleForwardedGatewayEvent).not.toHaveBeenCalled();
  });

  it('should fall back to the original forwarded handler for non-interaction events', async () => {
    const originalResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const originalHandleForwardedGatewayEvent = vi.fn().mockResolvedValue(originalResponse);
    const discordInteractionFetch = vi.fn();
    const handleApplicationCommandInteraction = vi.fn();
    const handleComponentInteraction = vi.fn();

    const adapter = {
      discordInteractionFetch,
      handleApplicationCommandInteraction,
      handleComponentInteraction,
      handleForwardedGatewayEvent: originalHandleForwardedGatewayEvent,
    };

    const chatBot = {
      adapters: new Map([['discord', adapter]]),
    } as any;

    patchDiscordForwardedInteractions(chatBot);

    const response = await adapter.handleForwardedGatewayEvent(
      { data: { id: 'msg-1' }, type: 'GATEWAY_MESSAGE_CREATE' },
      { foo: 'bar' },
    );

    expect(originalHandleForwardedGatewayEvent).toHaveBeenCalledWith(
      { data: { id: 'msg-1' }, type: 'GATEWAY_MESSAGE_CREATE' },
      { foo: 'bar' },
    );
    expect(discordInteractionFetch).not.toHaveBeenCalled();
    expect(handleApplicationCommandInteraction).not.toHaveBeenCalled();
    expect(handleComponentInteraction).not.toHaveBeenCalled();
    expect(response).toBe(originalResponse);
  });
});

/**
 * Drift guard against the real `@chat-adapter/discord`.
 *
 * The mocked suite above only proves "we call the adapter the way we think we
 * should" — which is exactly why the 4.32.0 signature change
 * (`handleApplicationCommandInteraction(interaction, options)` →
 * `(context, initialResponseFlags, options)`) shipped to production unnoticed
 * and left every gateway-forwarded Discord slash command spinning on
 * "Thinking...". These tests drive a real adapter + a real `Chat`, so the next
 * signature change fails CI instead of the bot.
 */
describe('patchDiscordForwardedInteractions — real @chat-adapter/discord', () => {
  const APPLICATION_ID = '111111111111111111';

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

  const slashInteraction = {
    channel_id: '333333333333333333',
    data: {
      name: 'start',
      options: [],
    },
    guild_id: '444444444444444444',
    id: '555555555555555555',
    token: 'interaction-token',
    type: 2,
    user: { global_name: 'JianXu', id: '222222222222222222', username: 'rdmclin2' },
  };

  const createPatchedBot = () => {
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

    patchDiscordForwardedInteractions(chatBot);
    return chatBot;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delivers a gateway-forwarded slash command to onSlashCommand and defers first', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const chatBot = createPatchedBot();
    const received: unknown[] = [];
    chatBot.onSlashCommand('/start', async (event) => {
      received.push(event);
    });
    await chatBot.initialize();

    const adapter = (chatBot as any).adapters.get('discord');
    const response = await adapter.handleForwardedGatewayEvent({
      data: slashInteraction,
      type: 'GATEWAY_INTERACTION_CREATE',
    });

    expect(response.status).toBe(200);
    // The handler must have run by the time we respond — the deferred
    // interaction is only resolved from inside it.
    expect(received).toHaveLength(1);
    expect((received[0] as { command: string }).command).toBe('/start');

    const deferCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes(
        `/interactions/${slashInteraction.id}/${slashInteraction.token}/callback`,
      ),
    );
    expect(deferCall).toBeDefined();
    expect(JSON.parse(deferCall![1].body)).toEqual({ type: 5 });
  });

  it('keeps the slash-command response context so replies complete the deferred interaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"999"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const chatBot = createPatchedBot();
    chatBot.onSlashCommand('/start', async (event) => {
      await event.channel.post('Your account is already linked to LobeHub.');
    });
    await chatBot.initialize();

    const adapter = (chatBot as any).adapters.get('discord');
    await adapter.handleForwardedGatewayEvent({
      data: slashInteraction,
      type: 'GATEWAY_INTERACTION_CREATE',
    });

    // Posting inside the slash context must PATCH the deferred original
    // message. A plain `POST /channels/:id/messages` would leave Discord
    // spinning on "Thinking..." forever.
    const editOriginal = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes(
          `/webhooks/${APPLICATION_ID}/${slashInteraction.token}/messages/@original`,
        ) && init?.method === 'PATCH',
    );
    expect(editOriginal).toBeDefined();
  });
});
