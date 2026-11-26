// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelRepository } from '..';
import { lockChannel } from '../transaction';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view-lock');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const threadChannel = async () => {
  const asOwner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel, member: owner } = await asOwner.create({ title: 'Busy' });
  const say = (content: string) =>
    asOwner.send(channel.id, {
      content,
      mentions: [owner.id],
      requestKey: content,
      routing: 'fallback',
    });
  const root = await say('Root');
  const other = await say('Other root');
  const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });
  await asOwner.createThread(channel.id, { rootMessageId: other.id });
  return { asOwner, channel, thread };
};

/** Runs `read` while another transaction holds the Channel's write lock. */
const readWhileLocked = async <T>(channelId: string, read: () => Promise<T>) => {
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const writer = db.transaction(async (tx) => {
    await lockChannel(tx, channelId);
    locked();
    await released;
  });
  await lockTaken;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('read waited for the Channel lock')), 2000),
      ),
    ]);
  } finally {
    release();
    await writer;
  }
};

describe('Channel detail under a write', () => {
  it('reads the main timeline and a Thread without waiting for the Channel lock', async () => {
    const { asOwner, channel, thread } = await threadChannel();

    const main = await readWhileLocked(channel.id, () => asOwner.detail(channel.id));
    expect(main.joined).toBe(true);
    expect(main.channel.canDelete).toBe(true);
    expect(main.threads).toHaveLength(2);

    const view = await readWhileLocked(channel.id, () =>
      asOwner.detail(channel.id, { threadId: thread.id }),
    );
    expect(view.threads.map((entry) => entry.id)).toEqual([thread.id]);
  });

  it('still refuses a missing Thread', async () => {
    const { asOwner, channel } = await threadChannel();
    await expect(asOwner.detail(channel.id, { threadId: 'cht_missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
