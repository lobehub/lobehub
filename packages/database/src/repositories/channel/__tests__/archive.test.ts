// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelAudit, channels, channelThreads } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-archive');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Helper');
  let key = 0;
  const send = (input: { mentions?: string[]; rootMessageId?: string; threadId?: string }) =>
    team.asOwner.send(team.channel.id, {
      content: 'Hello',
      requestKey: `archive-${++key}`,
      routing: 'fallback',
      ...input,
    });
  return { ...team, agent, send };
};

const events = async (targetId: string) =>
  (await db.select().from(channelAudit).where(eq(channelAudit.targetId, targetId))).map(
    (entry) => entry.event,
  );

describe('Channel archive', () => {
  it('keeps an archived channel listed and readable but closed to writes until unarchived', async () => {
    const { agent, asMember, asOwner, channel, send } = await setup();
    const root = await send({});
    const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });

    await asOwner.archive(channel.id);
    await asOwner.archive(channel.id);

    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, status: 'archived' }),
    ]);
    const view = await asMember.detail(channel.id);
    expect(view.channel.status).toBe('archived');
    expect(view.messages.map((message) => message.id)).toEqual([root.id]);
    await expect(asMember.markRead(channel.id, root.sequence)).resolves.toBe(root.sequence);

    const closed = [
      () => send({}),
      () => send({ threadId: thread.id }),
      () => asOwner.createThread(channel.id, { rootMessageId: root.id }),
      () => asOwner.rename(channel.id, 'Renamed'),
      () => asOwner.addAgent(channel.id, { agentId: agent.agentId! }),
      () => asOwner.archiveThread(channel.id, thread.id),
      () => asOwner.removeThread(channel.id, thread.id),
    ];
    for (const write of closed)
      await expect(write()).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Channel is archived',
      });

    await asOwner.unarchive(channel.id);
    await expect(send({})).resolves.toMatchObject({ channelId: channel.id });
    expect(await events(channel.id)).toEqual(expect.arrayContaining(['archived', 'unarchived']));
    expect((await events(channel.id)).filter((event) => event === 'archived')).toHaveLength(1);
  });

  it('lets only owners and admins archive or unarchive', async () => {
    const { asMember, asOwner, channel } = await setup();
    await expect(asMember.archive(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await asOwner.archive(channel.id);
    await expect(asMember.unarchive(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stops queued replies, which do not restart on unarchive', async () => {
    const { agent, asOwner, channel, send } = await setup();
    const request = await send({ mentions: [agent.id] });
    const [job] = await jobsOf(db, request.id);

    await asOwner.archive(channel.id);
    await asOwner.unarchive(channel.id);

    expect((await jobById(db, job.id)).status).toBe('cancelled');
    expect(await executions.claim(channel.id, job.id, lease)).toBeNull();
  });

  it('never starts a job queued in an archived channel', async () => {
    const { agent, channel, send } = await setup();
    const request = await send({ mentions: [agent.id] });
    const [job] = await jobsOf(db, request.id);
    await db.update(channels).set({ status: 'archived' }).where(eq(channels.id, channel.id));

    expect(await executions.claim(channel.id, job.id, lease)).toBeNull();
    expect((await jobById(db, job.id)).status).toBe('cancelled');
  });

  it('stays archived through a trash round trip, and an archived channel can still be trashed', async () => {
    const { asOwner, channel } = await setup();
    await asOwner.archive(channel.id);
    await asOwner.remove(channel.id);
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row).toMatchObject({ isDeleted: true, status: 'archived' });
  });
});

describe('Thread archive', () => {
  it('keeps an archived thread readable but closed to replies until unarchived', async () => {
    const { asMember, asOwner, channel, send } = await setup();
    const root = await send({});
    const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });
    const reply = await send({ threadId: thread.id });

    await asOwner.archiveThread(channel.id, thread.id);
    await asOwner.archiveThread(channel.id, thread.id);

    const main = await asMember.detail(channel.id);
    expect(main.threads).toEqual([expect.objectContaining({ id: thread.id, status: 'archived' })]);
    const view = await asMember.detail(channel.id, { threadId: thread.id });
    expect(view.messages.map((message) => message.id)).toEqual([reply.id]);
    // Reopening the branch from its root returns the same, still archived, thread.
    expect(await asOwner.createThread(channel.id, { rootMessageId: root.id })).toMatchObject({
      id: thread.id,
      status: 'archived',
    });

    for (const write of [
      () => send({ threadId: thread.id }),
      () => send({ rootMessageId: root.id }),
    ])
      await expect(write()).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Thread is archived',
      });
    // The main conversation is unaffected.
    await expect(send({})).resolves.toMatchObject({ threadId: null });

    await asOwner.unarchiveThread(channel.id, thread.id);
    await expect(send({ threadId: thread.id })).resolves.toMatchObject({ threadId: thread.id });
    expect(await events(thread.id)).toEqual(
      expect.arrayContaining(['thread_archived', 'thread_unarchived']),
    );
  });

  it('lets only owners and admins archive a thread', async () => {
    const { asMember, asOwner, channel, send } = await setup();
    const root = await send({});
    const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });
    await expect(asMember.archiveThread(channel.id, thread.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('stops the thread replies and never starts a job queued in an archived thread', async () => {
    const { agent, asOwner, channel, send } = await setup();
    const root = await send({});
    const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });
    const stopped = await send({ mentions: [agent.id], threadId: thread.id });
    const [stoppedJob] = await jobsOf(db, stopped.id);
    await asOwner.archiveThread(channel.id, thread.id);
    expect((await jobById(db, stoppedJob.id)).status).toBe('cancelled');

    await asOwner.unarchiveThread(channel.id, thread.id);
    const queued = await send({ mentions: [agent.id], threadId: thread.id });
    const [queuedJob] = await jobsOf(db, queued.id);
    await db
      .update(channelThreads)
      .set({ status: 'archived' })
      .where(eq(channelThreads.id, thread.id));
    expect(await executions.claim(channel.id, queuedJob.id, lease)).toBeNull();
    expect((await jobById(db, queuedJob.id)).status).toBe('cancelled');
  });
});
