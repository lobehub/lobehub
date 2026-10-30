// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TrashModel } from '../../../models/trash';
import { channelJobs, channelMessages, channelThreads } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { ChannelTrashRepository } from '../trash';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-thread-trash');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const registry = () => new TrashModel(db, fixture.ownerId);
const trash = () => new ChannelTrashRepository(db, fixture.ownerId);

/** A personal channel with one branch that holds a reply. */
const setup = async () => {
  const repo = new ChannelRepository(db, fixture.ownerId);
  const { channel } = await repo.create({ title: 'Planning' });
  const root = await repo.send(channel.id, {
    content: 'Should we ship on Friday?',
    requestKey: 'root',
    routing: 'fallback',
  });
  const thread = await repo.createThread(channel.id, { rootMessageId: root.id });
  const reply = await repo.send(channel.id, {
    content: 'Only after QA',
    requestKey: 'reply',
    routing: 'fallback',
    threadId: thread.id,
  });
  return { channel, repo, reply, root, thread };
};

describe('Channel thread recycle bin', () => {
  it('registers the branch as its own root and restores it with its replies', async () => {
    const { channel, repo, reply, thread } = await setup();
    await repo.removeThread(channel.id, thread.id);
    await repo.removeThread(channel.id, thread.id);

    const entry = await registry().findByResource('channelThread', thread.id);
    expect(entry).toMatchObject({
      deletedByUserId: fixture.ownerId,
      meta: { parentTitle: 'Planning' },
      resourceType: 'channelThread',
      rootId: null,
      title: 'Should we ship on Friday?',
    });
    expect((await repo.detail(channel.id)).threads).toEqual([]);

    expect(await trash().restoreThread(thread.id)).toBe('restored');
    expect(await registry().findByResource('channelThread', thread.id)).toBeUndefined();
    expect((await repo.detail(channel.id)).threads.map((t) => t.id)).toEqual([thread.id]);
    expect(
      (await repo.detail(channel.id, { threadId: thread.id })).messages.map((m) => m.id),
    ).toEqual([reply.id]);
    expect(await trash().restoreThread(thread.id)).toBe('missing');
  });

  it('refuses a restore that would collide with a newer branch on the same message', async () => {
    const { channel, repo, root, thread } = await setup();
    await repo.removeThread(channel.id, thread.id);
    const fresh = await repo.createThread(channel.id, { rootMessageId: root.id });

    expect(await trash().restoreThread(thread.id)).toBe('conflict');
    expect(await registry().findByResource('channelThread', thread.id)).toBeDefined();

    await repo.removeThread(channel.id, fresh.id);
    expect(await trash().restoreThread(thread.id)).toBe('restored');
  });

  it('waits for its channel to come back first', async () => {
    const { channel, repo, thread } = await setup();
    await repo.removeThread(channel.id, thread.id);
    await repo.remove(channel.id);

    expect(await trash().restoreThread(thread.id)).toBe('parentTrashed');
    expect(await trash().restore(channel.id)).toBe(true);
    // Restoring the channel does not bring back a branch trashed on its own.
    expect((await repo.detail(channel.id)).threads).toEqual([]);
    expect(await trash().restoreThread(thread.id)).toBe('restored');
  });

  it('purges only the branch, after its writer exits', async () => {
    const { channel, repo, reply, root, thread } = await setup();
    const agent = await fixture.addAgent(channel.id, 'Writer');
    const ask = await repo.send(channel.id, {
      content: 'Draft the checklist',
      mentions: [agent.id],
      requestKey: 'ask',
      routing: 'fallback',
      threadId: thread.id,
    });
    const [job] = await jobsOf(db, ask.id);
    const executions = new ChannelExecutionRepository(db);
    await executions.claim(channel.id, job.id, lease);
    await repo.removeThread(channel.id, thread.id);

    expect(await trash().purgeThread(thread.id)).toBe('busy');
    expect(await registry().findByResource('channelThread', thread.id)).toBeDefined();

    await executions.releaseWriter(channel.id, job.id);
    expect(await trash().purgeThread(thread.id)).toBe('purged');
    expect(await db.select().from(channelThreads).where(eq(channelThreads.id, thread.id))).toEqual(
      [],
    );
    const left = await db
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(eq(channelMessages.channelId, channel.id));
    expect(left.map((m) => m.id)).toEqual([root.id]);
    expect(left.map((m) => m.id)).not.toContain(reply.id);
    expect(
      await db
        .select()
        .from(channelJobs)
        .where(and(eq(channelJobs.channelId, channel.id), eq(channelJobs.id, job.id))),
    ).toEqual([]);
    expect(await registry().findByResource('channelThread', thread.id)).toBeUndefined();
    expect((await repo.detail(channel.id)).messages.map((m) => m.id)).toEqual([root.id]);
  });

  it('does not restore or purge a live branch or another user’s branch', async () => {
    const { channel, repo, thread } = await setup();
    expect(await trash().restoreThread(thread.id)).toBe('missing');
    expect(await trash().purgeThread(thread.id)).toBe('missing');

    await repo.removeThread(channel.id, thread.id);
    const stranger = new ChannelTrashRepository(db, fixture.memberId);
    expect(await stranger.restoreThread(thread.id)).toBe('missing');
    expect(await stranger.purgeThread(thread.id)).toBe('missing');
    expect(await db.select().from(channelThreads).where(eq(channelThreads.id, thread.id))).toEqual([
      expect.objectContaining({ isDeleted: true }),
    ]);
  });
});
