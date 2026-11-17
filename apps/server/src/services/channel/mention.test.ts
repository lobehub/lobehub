// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyChannelMentions } from './mention';

const { after, notifyChannelMention } = vi.hoisted(() => ({
  after: vi.fn(),
  notifyChannelMention: vi.fn(),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/business/server/channel-mention/notifyActivity', () => ({ notifyChannelMention }));

const dbReturning = (rows: { userId: string | null }[]) => {
  const where = vi.fn().mockResolvedValue(rows);
  const query = { innerJoin: () => query, where };
  return { db: { select: () => ({ from: () => query }) } as never, where };
};

const runScheduled = async () => {
  expect(after).toHaveBeenCalledTimes(1);
  await after.mock.calls[0][0]();
};

const message = { channelId: 'channel', id: 'message', mentions: ['member-a', 'member-b'] };

describe('notifyChannelMentions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('notifies the mentioned people other than the sender after the response', async () => {
    const { db } = dbReturning([
      { userId: 'sender' },
      { userId: 'teammate' },
      { userId: 'teammate' },
      { userId: null },
    ]);

    notifyChannelMentions(db, { userId: 'sender', workspaceId: 'workspace' }, message);
    expect(notifyChannelMention).not.toHaveBeenCalled();
    await runScheduled();

    expect(notifyChannelMention).toHaveBeenCalledWith({
      actorUserId: 'sender',
      channelId: 'channel',
      messageId: 'message',
      recipientUserIds: ['teammate'],
      workspaceId: 'workspace',
    });
  });

  it('skips personal Channels and messages without mentions', () => {
    const { db } = dbReturning([{ userId: 'teammate' }]);
    notifyChannelMentions(db, { userId: 'sender' }, message);
    notifyChannelMentions(
      db,
      { userId: 'sender', workspaceId: 'workspace' },
      { ...message, mentions: [] },
    );
    expect(after).not.toHaveBeenCalled();
  });

  it('stays silent when only Agents or the sender were mentioned', async () => {
    const { db } = dbReturning([{ userId: 'sender' }]);
    notifyChannelMentions(db, { userId: 'sender', workspaceId: 'workspace' }, message);
    await runScheduled();
    expect(notifyChannelMention).not.toHaveBeenCalled();
  });

  it('never surfaces a lookup failure', async () => {
    const { db, where } = dbReturning([]);
    where.mockRejectedValue(new Error('db unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    notifyChannelMentions(db, { userId: 'sender', workspaceId: 'workspace' }, message);
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(notifyChannelMention).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
