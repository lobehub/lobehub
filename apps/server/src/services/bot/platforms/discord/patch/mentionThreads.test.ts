import { describe, expect, it, vi } from 'vitest';

import { patchDiscordMentionThreads } from './mentionThreads';

const makeBot = () => {
  const createDiscordThread = vi.fn().mockResolvedValue({ id: 'auto-thread' });
  const adapter = { createDiscordThread };
  const chatBot = { adapters: new Map([['discord', adapter]]) } as any;

  return { adapter, chatBot, createDiscordThread };
};

describe('patchDiscordMentionThreads', () => {
  it('keeps an @-mention in the channel when the bot decides where to reply', async () => {
    const { adapter, chatBot, createDiscordThread } = makeBot();
    patchDiscordMentionThreads(chatBot, async () => true);

    // No id: the adapter then dispatches the message with the channel's own thread id.
    await expect(adapter.createDiscordThread('chan-1', 'msg-1')).resolves.toEqual({
      id: undefined,
    });
    expect(createDiscordThread).not.toHaveBeenCalled();
  });

  it("opens the adapter's thread as before when the bot does not decide", async () => {
    const { adapter, chatBot, createDiscordThread } = makeBot();
    patchDiscordMentionThreads(chatBot, async () => false);

    await expect(adapter.createDiscordThread('chan-1', 'msg-1')).resolves.toEqual({
      id: 'auto-thread',
    });
    expect(createDiscordThread).toHaveBeenCalledWith('chan-1', 'msg-1');
  });

  it('fails open to the auto-created thread when the question cannot be answered', async () => {
    const { adapter, chatBot, createDiscordThread } = makeBot();
    patchDiscordMentionThreads(chatBot, async () => {
      throw new Error('flag store down');
    });

    await expect(adapter.createDiscordThread('chan-1', 'msg-1')).resolves.toEqual({
      id: 'auto-thread',
    });
    expect(createDiscordThread).toHaveBeenCalledTimes(1);
  });

  it('patches an adapter once', async () => {
    const { adapter, chatBot, createDiscordThread } = makeBot();
    const first = vi.fn().mockResolvedValue(true);
    patchDiscordMentionThreads(chatBot, first);
    patchDiscordMentionThreads(chatBot, async () => false);

    await adapter.createDiscordThread('chan-1', 'msg-1');
    expect(first).toHaveBeenCalledTimes(1);
    expect(createDiscordThread).not.toHaveBeenCalled();
  });

  it('leaves a bot without a Discord adapter alone', () => {
    expect(() =>
      patchDiscordMentionThreads({ adapters: new Map() } as any, async () => true),
    ).not.toThrow();
  });
});
