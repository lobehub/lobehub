import { describe, expect, it, vi } from 'vitest';

import { patchDiscordForwardedInteractions } from './forwardedInteractions';

describe('patchDiscordForwardedInteractions', () => {
  it('should ACK and dispatch forwarded slash commands', async () => {
    const originalHandleForwardedGatewayEvent = vi.fn();
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
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
      {
        data: { id: 'interaction-1', token: 'token-1', type: 2 },
        type: 'GATEWAY_INTERACTION_CREATE',
      },
      { foo: 'bar' },
    );

    expect(discordInteractionFetch).toHaveBeenCalledWith(
      '/interactions/interaction-1/token-1/callback',
      'POST',
      { type: 5 },
    );
    expect(handleApplicationCommandInteraction).toHaveBeenCalledWith(
      { id: 'interaction-1', token: 'token-1', type: 2 },
      { foo: 'bar' },
    );
    expect(handleComponentInteraction).not.toHaveBeenCalled();
    expect(originalHandleForwardedGatewayEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should ACK and dispatch forwarded component interactions', async () => {
    const originalHandleForwardedGatewayEvent = vi.fn();
    const discordInteractionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
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
      { foo: 'bar' },
    );
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
