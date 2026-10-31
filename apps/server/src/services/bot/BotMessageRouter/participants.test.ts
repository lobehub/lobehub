import type { Message } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import { createParticipantTracker, isSoloThreadConversation } from './participants';

const threadParticipantsKey = (threadId: string) => `messenger:thread-humans:${threadId}`;

const thread = { id: 'discord:guild-1:channel-1:thread-1', isDM: false };

const makeState = (initial: string[] = []) => {
  const lists = new Map<string, string[]>([[threadParticipantsKey(thread.id), [...initial]]]);
  return {
    appendToList: vi.fn(async (key: string, id: unknown) => {
      lists.set(key, [...(lists.get(key) ?? []), id as string]);
    }),
    getList: vi.fn(async (key: string) => lists.get(key) ?? []),
    lists,
  };
};

const trackThreadParticipants = (
  state: ReturnType<typeof makeState>,
  ...args: [typeof thread, Message[]]
) => createParticipantTracker({ getState: () => state } as any)(...args);

const message = (userId: string, author: { isBot?: boolean; isMe?: boolean } = {}) =>
  ({ author: { isBot: false, userId, userName: userId, ...author }, text: 'hi' }) as Message;

describe('trackThreadParticipants', () => {
  it('counts another Agent (bot account) as a participant', async () => {
    const state = makeState(['alice-id']);

    const tracked = await trackThreadParticipants(state, thread, [
      message('other-agent', { isBot: true }),
    ]);

    expect(tracked).toEqual({ count: 2, isNewParticipant: true });
    expect(state.lists.get(threadParticipantsKey(thread.id))).toEqual(['alice-id', 'other-agent']);
  });

  it('does not count its own messages', async () => {
    const state = makeState(['alice-id']);

    const tracked = await trackThreadParticipants(state, thread, [
      message('self-bot', { isBot: true, isMe: true }),
    ]);

    expect(tracked).toEqual({ count: 0, isNewParticipant: false });
    expect(state.appendToList).not.toHaveBeenCalled();
  });

  it('dedupes a returning participant', async () => {
    const state = makeState(['alice-id']);

    const tracked = await trackThreadParticipants(state, thread, [message('alice-id')]);

    expect(tracked).toEqual({ count: 1, isNewParticipant: false });
  });

  it('ignores DMs', async () => {
    const state = makeState();

    const tracked = await trackThreadParticipants(state, { ...thread, isDM: true }, [
      message('alice-id'),
    ]);

    expect(tracked.count).toBe(0);
    expect(state.appendToList).not.toHaveBeenCalled();
  });
});

describe('isSoloThreadConversation', () => {
  it('allows replies without an @mention while one person talks with the bot', async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    expect(await isSoloThreadConversation(1, lookup)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('requires an @mention once a second participant speaks, even while membership still reports solo', async () => {
    // Regression: the Discord solo verdict is cached for 60s and lags behind
    // the second participant's first message.
    const lookup = vi.fn().mockResolvedValue(true);

    expect(await isSoloThreadConversation(2, lookup)).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('requires an @mention once another Agent speaks', async () => {
    const state = makeState();
    await trackThreadParticipants(state, thread, [message('alice-id')]);
    const { count } = await trackThreadParticipants(state, thread, [
      message('other-agent', { isBot: true }),
    ]);

    expect(await isSoloThreadConversation(count, vi.fn().mockResolvedValue(true))).toBe(false);
  });

  it('trusts membership when it reports a shared thread with one speaker', async () => {
    expect(await isSoloThreadConversation(1, vi.fn().mockResolvedValue(false))).toBe(false);
  });

  it('fails closed when the membership lookup throws', async () => {
    expect(await isSoloThreadConversation(1, vi.fn().mockRejectedValue(new Error('403')))).toBe(
      false,
    );
  });

  it('falls back to the speaker count without a membership lookup', async () => {
    expect(await isSoloThreadConversation(1)).toBe(true);
    expect(await isSoloThreadConversation(2)).toBe(false);
  });
});
