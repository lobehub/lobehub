// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyChannelDirectMessages } from './directMessage';

const { after, notifyChannelDirectMessage } = vi.hoisted(() => ({
  after: vi.fn(),
  notifyChannelDirectMessage: vi.fn(),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/business/server/channel-message/notifyActivity', () => ({
  notifyChannelDirectMessage,
}));

/** The conversation lookup, then the recipient's own member row (muted or not). */
const dbReturning = (
  rows: { ownerId: string | null; peerUserId: string | null }[],
  recipient: { muted: boolean }[] = [{ muted: false }],
) => {
  const limit = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(recipient);
  return { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) } as never;
};

const runScheduled = async () => {
  expect(after).toHaveBeenCalledTimes(1);
  await after.mock.calls[0][0]();
};

const message = { channelId: 'channel', id: 'message' };
const conversation = { ownerId: 'opener', peerUserId: 'peer' };

describe('notifyChannelDirectMessages', () => {
  beforeEach(() => vi.resetAllMocks());

  it('pings the peer about a message from the person who opened the conversation', async () => {
    notifyChannelDirectMessages(dbReturning([conversation]), { userId: 'opener' }, message);
    expect(notifyChannelDirectMessage).not.toHaveBeenCalled();
    await runScheduled();

    expect(notifyChannelDirectMessage).toHaveBeenCalledWith({
      actorUserId: 'opener',
      channelId: 'channel',
      messageId: 'message',
      recipientUserId: 'peer',
    });
  });

  it('pings the opener when the peer writes back', async () => {
    notifyChannelDirectMessages(dbReturning([conversation]), { userId: 'peer' }, message);
    await runScheduled();

    expect(notifyChannelDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'peer', recipientUserId: 'opener' }),
    );
  });

  it('pings a fellow member in a workspace too', async () => {
    notifyChannelDirectMessages(
      dbReturning([conversation]),
      { userId: 'opener', workspaceId: 'workspace' },
      message,
    );
    await runScheduled();

    expect(notifyChannelDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'opener', recipientUserId: 'peer' }),
    );
  });

  it('skips a recipient who muted the conversation for themself', async () => {
    notifyChannelDirectMessages(
      dbReturning([conversation], [{ muted: true }]),
      { userId: 'opener' },
      message,
    );
    await runScheduled();
    expect(notifyChannelDirectMessage).not.toHaveBeenCalled();
  });

  it('skips personal Channels that are not between two people', async () => {
    notifyChannelDirectMessages(
      dbReturning([{ ownerId: 'opener', peerUserId: null }]),
      { userId: 'opener' },
      message,
    );
    await runScheduled();
    expect(notifyChannelDirectMessage).not.toHaveBeenCalled();
  });

  it('skips a sender who is neither person of the conversation', async () => {
    notifyChannelDirectMessages(dbReturning([conversation]), { userId: 'stranger' }, message);
    await runScheduled();
    expect(notifyChannelDirectMessage).not.toHaveBeenCalled();
  });

  it('never fails the send when the notification fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    notifyChannelDirectMessage.mockRejectedValue(new Error('down'));
    notifyChannelDirectMessages(dbReturning([conversation]), { userId: 'opener' }, message);

    await expect(runScheduled()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
