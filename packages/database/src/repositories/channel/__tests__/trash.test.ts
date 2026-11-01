// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TrashModel } from '../../../models/trash';
import {
  agents,
  channelJobs,
  channelMembers,
  channels,
  channelThreads,
  trashItems,
} from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { ChannelTrashRepository } from '../trash';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-trash');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const registry = () => new TrashModel(db, fixture.ownerId);
const trash = () => new ChannelTrashRepository(db, fixture.ownerId);

describe('Channel recycle bin', () => {
  it('registers deletion once and restores history, members and thread visibility', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Keep this history' });
    const agent = await fixture.addAgent(channel.id, 'Keep Agent');
    const root = await repo.send(channel.id, {
      content: 'Root',
      requestKey: 'root',
      routing: 'fallback',
    });
    const visible = await repo.createThread(channel.id, { rootMessageId: root.id });
    const second = await repo.send(channel.id, {
      content: 'Other',
      requestKey: 'other',
      routing: 'fallback',
    });
    const hidden = await repo.createThread(channel.id, { rootMessageId: second.id });
    await repo.removeThread(channel.id, hidden.id);
    await repo.remove(channel.id);
    const entry = await registry().findByResource('channel', channel.id);
    expect(entry).toMatchObject({
      title: channel.title,
      resourceType: 'channel',
      deletedByUserId: fixture.ownerId,
    });
    await repo.remove(channel.id);
    expect(await registry().findByResource('channel', channel.id)).toEqual(entry);
    expect(await trash().restore(channel.id)).toBe(true);
    expect(await registry().findByResource('channel', channel.id)).toBeUndefined();
    const detail = await repo.detail(channel.id);
    expect(detail.messages.map((message) => message.id)).toEqual([root.id, second.id]);
    expect(detail.threads.map((thread) => thread.id)).toEqual([visible.id]);
    expect(detail.members.some((member) => member.id === agent.id)).toBe(true);
    expect(await db.select().from(channelThreads).where(eq(channelThreads.id, hidden.id))).toEqual([
      expect.objectContaining({ isDeleted: true }),
    ]);
    expect(await trash().restore(channel.id)).toBe(false);
  });

  it('registers the deleting workspace admin and scopes restore independently of the creator', async () => {
    const { channel, member, asMember, asOwner } = await fixture.createTeamChannel();
    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    await asMember.remove(channel.id);
    const entry = await new TrashModel(db, fixture.memberId, fixture.workspaceId).findByResource(
      'channel',
      channel.id,
    );
    expect(entry).toMatchObject({
      userId: fixture.memberId,
      deletedByUserId: fixture.memberId,
      workspaceId: fixture.workspaceId,
    });
    expect(await trash().restore(channel.id)).toBe(false);
    expect(
      await new ChannelTrashRepository(db, fixture.ownerId, 'other-workspace').restore(channel.id),
    ).toBe(false);
    // The workspace trash router authorizes either its owner or the deleting user.
    expect(
      await new ChannelTrashRepository(db, fixture.ownerId, fixture.workspaceId).restore(
        channel.id,
      ),
    ).toBe(true);
    expect(await asOwner.list()).toHaveLength(1);
  });

  it('does not restore or purge another personal user’s channel, or purge a live channel', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Private' });
    await trash().purge(channel.id);
    expect(await repo.list()).toHaveLength(1);
    await repo.remove(channel.id);
    const stranger = new ChannelTrashRepository(db, fixture.memberId);
    expect(await stranger.restore(channel.id)).toBe(false);
    await stranger.purge(channel.id);
    expect(await db.select().from(channels).where(eq(channels.id, channel.id))).toHaveLength(1);
    expect(await registry().findByResource('channel', channel.id)).toBeDefined();
  });

  it('keeps cancellation fences through restore and refuses purge until the writer exits', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Running' });
    const agent = await fixture.addAgent(channel.id, 'Writer');
    const message = await repo.send(channel.id, {
      content: 'Work',
      mentions: [agent.id],
      requestKey: 'run',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const executions = new ChannelExecutionRepository(db);
    await executions.claim(channel.id, job.id, lease);
    await repo.remove(channel.id);
    await expect(trash().purge(channel.id)).resolves.toBe('busy');
    expect(await registry().findByResource('channel', channel.id)).toBeDefined();
    await trash().restore(channel.id);
    expect(await db.select().from(channelJobs).where(eq(channelJobs.id, job.id))).toEqual([
      expect.objectContaining({ status: 'cancelled', publicationRevoked: true, writerHeld: true }),
    ]);
    await expect(executions.publish(channel.id, job.id)).rejects.toThrow();
    await executions.releaseWriter(channel.id, job.id);
    await repo.remove(channel.id);
    await expect(trash().purge(channel.id)).resolves.toBe('purged');
    expect(await db.select().from(channels).where(eq(channels.id, channel.id))).toEqual([]);
    expect(await db.select().from(trashItems).where(eq(trashItems.resourceId, channel.id))).toEqual(
      [],
    );
    expect(await db.select().from(agents).where(eq(agents.id, agent.agentId!))).toHaveLength(1);
  });
});
