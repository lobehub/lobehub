import { Message } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import { patchSenderBatches } from '../patchSenderBatches';

const message = (id: string) =>
  new Message({
    attachments: [],
    author: { fullName: id, isBot: false, isMe: false, userId: id, userName: id },
    formatted: { type: 'root', children: [] },
    id,
    metadata: { dateSent: new Date(), edited: false },
    raw: {},
    text: id,
    threadId: 'thread',
  });

describe('sender batch failure isolation', () => {
  it('still delivers later senders when an earlier sender handler rejects', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('first sender failed'))
      .mockResolvedValue(undefined);
    const bot = { dispatchToHandlers: dispatch };
    patchSenderBatches(bot as any);
    const alice = message('alice');
    const bob = message('bob');

    await expect(
      bot.dispatchToHandlers({} as any, 'thread', bob, {
        skipped: [alice],
        totalSinceLastHandler: 2,
      }),
    ).rejects.toThrow('Sender batch dispatch failed');
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map((call) => call[2].author.userId)).toEqual(['alice', 'bob']);
  });
});
