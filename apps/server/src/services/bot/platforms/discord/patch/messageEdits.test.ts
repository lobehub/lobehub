import { describe, expect, it, vi } from 'vitest';

import { patchDiscordMessageEdits } from './messageEdits';

vi.mock('@/server/services/redis', () => ({ redisService: { botWake: {} } }));

const APP_ID = 'app-1';
const NOW = Date.parse('2026-10-28T02:30:00.000Z');
const SENT_AT = '2026-10-28T02:20:00.000Z';

const makeBot = (deps: { claim?: boolean; initiated?: boolean } = {}) => {
  const originalGatewayEvent = vi.fn().mockResolvedValue(new Response('original'));
  const handleForwardedMessage = vi.fn().mockResolvedValue(undefined);
  const adapter = {
    applicationId: APP_ID,
    handleForwardedGatewayEvent: originalGatewayEvent,
    handleForwardedMessage,
    name: 'discord',
  };
  const state = { delete: vi.fn().mockResolvedValue(undefined) };
  const handleIncomingMessage = vi.fn().mockResolvedValue(undefined);
  const chatBot = {
    adapters: new Map([['discord', adapter]]),
    getState: () => state,
    handleIncomingMessage,
  } as any;
  const claimEditWake = vi.fn().mockResolvedValue(deps.claim ?? true);
  const hasInitiation = vi.fn().mockResolvedValue(deps.initiated ?? false);
  const markEngaged = vi.fn().mockResolvedValue(undefined);

  patchDiscordMessageEdits(chatBot, {
    claimEditWake,
    hasInitiation,
    markEngaged,
    now: () => NOW,
  });

  return {
    adapter,
    chatBot,
    claimEditWake,
    handleForwardedMessage,
    handleIncomingMessage,
    hasInitiation,
    markEngaged,
    originalGatewayEvent,
    state,
  };
};

const message = (overrides: Record<string, unknown> = {}) => ({
  author: { id: 'user-1' },
  channel_id: 'chan-1',
  content: '现在lobehub没有动态和works这两个feature吧 <@app-1>',
  edited_timestamp: '2026-10-28T02:21:00.000Z',
  guild_id: 'guild-1',
  id: 'msg-1',
  mentions: [{ id: APP_ID }],
  timestamp: SENT_AT,
  ...overrides,
});

const update = (data: Record<string, unknown>) => ({ data, type: 'GATEWAY_MESSAGE_UPDATE' });

describe('patchDiscordMessageEdits', () => {
  it('routes an edit that newly @-mentions the bot as a fresh mention', async () => {
    const bot = makeBot();
    const data = message();

    const response = await bot.adapter.handleForwardedGatewayEvent(update(data), { a: 1 });

    expect(response.status).toBe(200);
    expect(bot.hasInitiation).toHaveBeenCalledWith(APP_ID, 'msg-1');
    expect(bot.claimEditWake).toHaveBeenCalledWith(APP_ID, 'msg-1');
    // The Chat SDK would drop the id it saw when the message was first sent.
    expect(bot.state.delete).toHaveBeenCalledWith('dedupe:discord:msg-1');
    expect(bot.handleForwardedMessage).toHaveBeenCalledWith(data, { a: 1 });
    expect(bot.originalGatewayEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['the edit does not mention the bot', { mentions: [{ id: 'someone-else' }] }],
    ['only an embed was unfurled', { edited_timestamp: null }],
    ['it is a DM', { guild_id: undefined }],
    ['a bot edited it', { author: { bot: true, id: 'bot-2' } }],
    ['it was sent more than 30 minutes ago', { timestamp: '2026-10-28T01:59:00.000Z' }],
  ])('ignores the edit when %s', async (_case, overrides) => {
    const bot = makeBot();

    const response = await bot.adapter.handleForwardedGatewayEvent(update(message(overrides)));

    expect(response.status).toBe(200);
    expect(bot.claimEditWake).not.toHaveBeenCalled();
    expect(bot.handleForwardedMessage).not.toHaveBeenCalled();
  });

  it('does not wake again on a message that already engaged the bot', async () => {
    const bot = makeBot({ claim: false });

    await bot.adapter.handleForwardedGatewayEvent(update(message()));

    expect(bot.claimEditWake).toHaveBeenCalled();
    expect(bot.state.delete).not.toHaveBeenCalled();
    expect(bot.handleForwardedMessage).not.toHaveBeenCalled();
  });

  it('does not wake on a message the wake pipeline already decided to take', async () => {
    const bot = makeBot({ initiated: true });

    await bot.adapter.handleForwardedGatewayEvent(update(message()));

    expect(bot.claimEditWake).not.toHaveBeenCalled();
    expect(bot.handleForwardedMessage).not.toHaveBeenCalled();
  });

  it('stays silent when the claim cannot be made', async () => {
    const bot = makeBot();
    bot.claimEditWake.mockRejectedValueOnce(new Error('redis down'));

    const response = await bot.adapter.handleForwardedGatewayEvent(update(message()));

    expect(response.status).toBe(200);
    expect(bot.handleForwardedMessage).not.toHaveBeenCalled();
  });

  it('remembers a message that @-mentioned the bot when sent, then handles it as before', async () => {
    const bot = makeBot();
    const event = { data: message({ edited_timestamp: null }), type: 'GATEWAY_MESSAGE_CREATE' };

    await bot.adapter.handleForwardedGatewayEvent(event, { a: 1 });

    expect(bot.markEngaged).toHaveBeenCalledWith(APP_ID, ['msg-1']);
    expect(bot.originalGatewayEvent).toHaveBeenCalledWith(event, { a: 1 });
  });

  it('does not mark a message that did not mention the bot when sent', async () => {
    const bot = makeBot();

    await bot.adapter.handleForwardedGatewayEvent({
      data: message({ mentions: [] }),
      type: 'GATEWAY_MESSAGE_CREATE',
    });

    expect(bot.markEngaged).not.toHaveBeenCalled();
    expect(bot.originalGatewayEvent).toHaveBeenCalled();
  });

  it('passes other events through untouched', async () => {
    const bot = makeBot();
    const event = { data: {}, type: 'GATEWAY_MESSAGE_REACTION_ADD' };

    await bot.adapter.handleForwardedGatewayEvent(event);

    expect(bot.originalGatewayEvent).toHaveBeenCalledWith(event, undefined);
  });

  it('marks a message dispatched from an edit as edited', async () => {
    const bot = makeBot();
    const edited = {
      metadata: { dateSent: new Date(SENT_AT), edited: false },
      raw: message(),
    } as any;
    const fresh = {
      metadata: { dateSent: new Date(SENT_AT), edited: false },
      raw: message({ edited_timestamp: null }),
    } as any;

    await bot.chatBot.handleIncomingMessage(bot.adapter, 'thread-1', edited);
    await bot.chatBot.handleIncomingMessage(bot.adapter, 'thread-1', fresh);

    expect(edited.metadata).toEqual({
      dateSent: new Date(SENT_AT),
      edited: true,
      editedAt: new Date('2026-10-28T02:21:00.000Z'),
    });
    expect(fresh.metadata.edited).toBe(false);
    expect(bot.handleIncomingMessage).toHaveBeenCalledTimes(2);
  });

  it('patches an adapter only once', async () => {
    const bot = makeBot();
    patchDiscordMessageEdits(bot.chatBot, {
      claimEditWake: vi.fn(),
      hasInitiation: vi.fn(),
      markEngaged: vi.fn(),
    });

    await bot.adapter.handleForwardedGatewayEvent(update(message()));

    expect(bot.handleForwardedMessage).toHaveBeenCalledTimes(1);
  });
});
