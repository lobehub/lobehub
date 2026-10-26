// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, channelMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel public view', () => {
  it('returns an ordered page without exposing execution config, private topics or drafts', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Researcher');
    const first = await asOwner.send(channel.id, {
      content: 'First',
      requestKey: '1',
      routing: 'fallback',
    });
    await asOwner.send(channel.id, { content: 'Second', requestKey: '2', routing: 'fallback' });
    const third = await asOwner.send(channel.id, {
      content: 'Third',
      requestKey: '3',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, first.id);
    const executions = new ChannelExecutionRepository(db);
    await executions.claim(channel.id, job.id, lease);
    await executions.saveDraft(channel.id, job.id, 'Unpublished private draft');

    const view = await asOwner.detail(channel.id, { limit: 2 });
    expect(view.messages.map((message) => message.content)).toEqual(['Second', 'Third']);
    expect(view.hasMore).toBe(true);
    expect(view.members.find((member) => member.id === agent.id)?.name).toBe('Researcher');
    expect(view.jobs[0]).not.toHaveProperty('topicId');
    expect(view.jobs[0]).not.toHaveProperty('operationId');
    expect(view.jobs[0]).not.toHaveProperty('executionConfig');
    expect(view).not.toHaveProperty('member');
    expect(view.members.every((member) => !('config' in member))).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Unpublished private draft');
    expect(
      (await asOwner.detail(channel.id, { before: third.sequence, limit: 2 })).messages.map(
        (message) => message.content,
      ),
    ).toEqual(['First', 'Second']);
  });

  it('enforces membership, scope and revocation on the aggregate view', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    expect((await asMember.detail(channel.id)).channel.id).toBe(channel.id);
    await expect(
      new ChannelRepository(db, fixture.ownerId).detail(channel.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.update(channelMembers).set({ active: false }).where(eq(channelMembers.id, member.id));
    await expect(asMember.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('branches once from a main message without replaying jobs and isolates branch messages', async () => {
    const { asOwner, channel, owner } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Researcher');
    const root = await asOwner.send(channel.id, {
      content: 'Root',
      mentions: [owner.id],
      requestKey: 'root',
      routing: 'fallback',
    });
    const input = { followerMemberIds: [agent.id, agent.id], rootMessageId: root.id };
    const thread = await asOwner.createThread(channel.id, input);
    expect((await asOwner.createThread(channel.id, input)).id).toBe(thread.id);
    expect(thread.followerMemberIds).toEqual([agent.id]);
    expect(await jobsOf(db, root.id)).toEqual([]);
    const reply = await asOwner.send(channel.id, {
      content: 'Branch request',
      requestKey: 'thread',
      routing: 'fallback',
      threadId: thread.id,
    });
    expect((await asOwner.detail(channel.id)).messages.map((m) => m.id)).toEqual([root.id]);
    expect(
      (await asOwner.detail(channel.id, { threadId: thread.id })).messages.map((m) => m.id),
    ).toEqual([reply.id]);
    expect(await jobsOf(db, reply.id)).toHaveLength(1);
    await expect(
      asOwner.createThread(channel.id, { ...input, rootMessageId: reply.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a thread, root or follower from another channel', async () => {
    const one = await fixture.createTeamChannel('One');
    const two = await fixture.createTeamChannel('Two');
    const agent = await fixture.addAgent(two.channel.id, 'Other');
    const root = await two.asOwner.send(two.channel.id, {
      content: 'Other branch',
      requestKey: 'other',
      routing: 'fallback',
    });
    const thread = await two.asOwner.createThread(two.channel.id, {
      followerMemberIds: [agent.id],
      rootMessageId: root.id,
    });
    await expect(one.asOwner.detail(one.channel.id, { threadId: thread.id })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      one.asOwner.createThread(one.channel.id, {
        followerMemberIds: [],
        rootMessageId: root.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      two.asOwner.createThread(two.channel.id, {
        followerMemberIds: [one.owner.id],
        rootMessageId: root.id,
      }),
    ).resolves.toMatchObject({ id: thread.id }); // An existing thread is an idempotent open.
  });

  it('creates the selected members atomically and rolls back unavailable Agents', async () => {
    const { channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Researcher');
    const repo = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const created = await repo.create({
      agents: [{ agentId: agent.agentId! }],
      title: 'With agent',
    });
    expect((await repo.detail(created.channel.id)).members).toHaveLength(2);
    const count = (await repo.list()).length;
    await expect(
      repo.create({
        agents: [{ agentId: agent.agentId! }, { agentId: 'unavailable' }],
        title: 'Rollback',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repo.list()).toHaveLength(count);
  });

  it('keeps read receipts monotonic and bounded by the persisted sequence', async () => {
    const { asOwner, channel, owner } = await fixture.createTeamChannel();
    await asOwner.send(channel.id, { content: 'Read me', requestKey: '1', routing: 'fallback' });
    expect(await asOwner.markRead(channel.id, 500)).toBe(1);
    expect(await asOwner.markRead(channel.id, 0)).toBe(1);
    const view = await asOwner.detail(channel.id);
    expect(view.members.find((member) => member.id === owner.id)?.lastReadSequence).toBe(1);
    expect(
      await db.select().from(channelJobs).where(eq(channelJobs.channelId, channel.id)),
    ).toEqual([]);
  });

  it('preserves the actual reply author when a member is rebound', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const original = await fixture.addAgent(channel.id, 'Original');
    const replacement = await fixture.addAgent(channel.id, 'Replacement');
    const request = await asOwner.send(channel.id, {
      content: 'Reply once',
      mentions: [original.id],
      requestKey: 'author',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, request.id);
    const executions = new ChannelExecutionRepository(db);
    await executions.claim(channel.id, job.id, lease);
    await executions.accepted(channel.id, job.id, {});
    await executions.saveDraft(channel.id, job.id, 'Original reply');
    await executions.publish(channel.id, job.id);
    await db
      .update(channelMembers)
      .set({ agentId: replacement.agentId })
      .where(eq(channelMembers.id, original.id));
    const view = await asOwner.detail(channel.id);
    expect(view.messages[0].author).toMatchObject({ id: fixture.ownerId, type: 'user' });
    expect(view.messages[1].author).toMatchObject({
      id: original.agentId,
      name: 'Original',
      type: 'agent',
    });
  });
});
