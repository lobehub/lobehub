import { describe, expect, it, vi } from 'vitest';

import { patchDiscordThreadRecovery } from './threadRecovery';

describe('patchDiscordThreadRecovery', () => {
  it('should recover an existing thread when Discord reports it was already created', async () => {
    const createDiscordThread = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'NetworkError: Discord API error: 400 {"message":"A thread has already been created for this message","code":160004}',
        ),
      );
    const discordFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'message-1',
          thread: { id: 'thread-1' },
        }),
        { status: 200 },
      ),
    );

    const adapter = {
      createDiscordThread,
      discordFetch,
      logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };
    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;

    patchDiscordThreadRecovery(chatBot);

    await expect(adapter.createDiscordThread('channel-1', 'message-1')).resolves.toEqual({
      id: 'thread-1',
    });
    expect(discordFetch).toHaveBeenCalledWith('/channels/channel-1/messages/message-1', 'GET');
  });

  it('should rethrow non-recoverable thread creation errors', async () => {
    const originalError = new Error('Discord API error: 403 {"message":"Missing permissions"}');
    const createDiscordThread = vi.fn().mockRejectedValueOnce(originalError);
    const discordFetch = vi.fn();

    const adapter = { createDiscordThread, discordFetch };
    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;

    patchDiscordThreadRecovery(chatBot);

    await expect(adapter.createDiscordThread('channel-1', 'message-1')).rejects.toBe(originalError);
    expect(discordFetch).not.toHaveBeenCalled();
  });

  it('should rethrow the original error when recovery cannot find a thread', async () => {
    const originalError = new Error(
      'NetworkError: Discord API error: 400 {"message":"A thread has already been created for this message","code":160004}',
    );
    const createDiscordThread = vi.fn().mockRejectedValueOnce(originalError);
    const discordFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'message-1',
        }),
        { status: 200 },
      ),
    );

    const adapter = {
      createDiscordThread,
      discordFetch,
      logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };
    const chatBot = { adapters: new Map([['discord', adapter]]) } as any;

    patchDiscordThreadRecovery(chatBot);

    await expect(adapter.createDiscordThread('channel-1', 'message-1')).rejects.toBe(originalError);
    expect(discordFetch).toHaveBeenCalledWith('/channels/channel-1/messages/message-1', 'GET');
  });
});
