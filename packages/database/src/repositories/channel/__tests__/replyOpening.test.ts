// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelJobs, channelMessages, channelThreads } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-opening');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const mentionAgent = async (content = 'Why did yesterday’s deploy fail?') => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder');
  const message = await team.asMember.send(team.channel.id, {
    content,
    mentions: [agent.id],
    requestKey: `req-${content.length}`,
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);

  return { ...team, agent, job, message };
};

const messagesOf = (channelId: string) =>
  db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.channelId, channelId))
    .orderBy(channelMessages.sequence);

describe('Channel reply opening', () => {
  it('hands the opener the request, the Agent and whether a Thread can open', async () => {
    const { agent, channel, job, message } = await mentionAgent();

    const candidate = await execution.openingCandidate(channel.id, job.id);

    expect(candidate).toMatchObject({
      agent: { id: agent.agentId, name: 'Coder' },
      canOpenThread: true,
      recent: [],
      request: { content: 'Why did yesterday’s deploy fail?', id: message.id },
      requesterUserId: fixture.memberId,
    });
  });

  it('acknowledges in the main timeline, once, and the run continues from it', async () => {
    const { agent, channel, job, message } = await mentionAgent();

    expect(await execution.open(channel.id, job.id, { ack: 'Got it, checking the logs.' })).toBe(
      true,
    );
    expect(await execution.open(channel.id, job.id, { ack: 'Again' })).toBe(false);
    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();

    const ack = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(ack).toEqual([
      expect.objectContaining({
        agentId: agent.agentId,
        content: 'Got it, checking the logs.',
        replyToId: message.id,
        threadId: null,
        userId: null,
      }),
    ]);
    expect(await execution.openingReply(channel.id, job.id)).toBe('Got it, checking the logs.');
    expect((await jobById(db, job.id)).threadId).toBeNull();
  });

  it('moves the reply into a named Thread under the request before the claim', async () => {
    const { channel, job, member, message } = await mentionAgent();

    await execution.open(channel.id, job.id, {
      ack: 'On it, I will compare the two configs first.',
      threadTitle: 'Deploy failure',
    });

    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.rootMessageId, message.id));
    expect(thread).toMatchObject({ metadata: { title: 'Deploy failure' } });
    expect(new Set(thread.followerMemberIds)).toEqual(new Set([member.id, job.memberId]));
    expect((await jobById(db, job.id)).threadId).toBe(thread.id);
    const [ack] = await db
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, channel.id),
          eq(channelMessages.requestKey, `opening:${job.id}`),
        ),
      );
    expect(ack).toMatchObject({ replyToId: null, threadId: thread.id });

    // The run starts in the Thread, and its answer lands there.
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.manifest).toMatchObject({
      cutoffSequence: message.sequence,
      threadId: thread.id,
      threadRootSequence: message.sequence,
    });
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The token expired.');
    const replyId = await execution.publish(channel.id, job.id);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply.threadId).toBe(thread.id);

    const detail = await new ChannelRepository(db, fixture.memberId, fixture.workspaceId).detail(
      channel.id,
    );
    expect(detail.threads).toEqual([expect.objectContaining({ title: 'Deploy failure' })]);
  });

  it('keeps the acknowledgement out of the next run’s unseen context', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    await execution.open(channel.id, job.id, { ack: 'Got it, checking the logs.' });
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The token expired.');
    await execution.publish(channel.id, job.id);
    await execution.releaseWriter(channel.id, job.id);

    const next = await asMember.send(channel.id, {
      content: 'Thanks',
      mentions: [agent.id],
      requestKey: 'req-next',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    const claim = await execution.claim(channel.id, nextJob.id, lease);
    expect(claim?.topic.id).toBe((await jobById(db, job.id)).topicId);

    expect(await execution.recentContext(channel.id, nextJob.id)).toEqual({
      messages: [],
      omitted: 0,
    });
  });

  it('acknowledges in a direct conversation but never moves it into a Thread', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ name: 'Assistant', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await repository.create({ agentId: agent.id, title: 'Direct' });
    const message = await repository.send(channel.id, {
      content: 'Summarize this week',
      requestKey: 'direct',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);

    expect(await execution.openingCandidate(channel.id, job.id)).toMatchObject({
      canOpenThread: false,
    });
    await execution.open(channel.id, job.id, { ack: 'On it.', threadTitle: 'This week' });

    expect((await jobById(db, job.id)).threadId).toBeNull();
    expect(
      await db.select().from(channelThreads).where(eq(channelThreads.channelId, channel.id)),
    ).toEqual([]);
    expect(await execution.openingReply(channel.id, job.id)).toBe('On it.');
  });

  it('never opens a wake that may stay silent', async () => {
    const { channel, job } = await mentionAgent();
    await db
      .update(channelJobs)
      .set({ wake: { kind: 'followup', reason: 'followup-window' } as never })
      .where(eq(channelJobs.id, job.id));

    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();
  });

  it('records an opening that changed nothing, so the opener is not asked again', async () => {
    const { channel, job } = await mentionAgent();

    expect(await execution.open(channel.id, job.id, {})).toBe(true);

    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();
    expect((await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply')).toEqual(
      [],
    );
  });

  it('does not open a job that already started', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);

    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();
    expect(await execution.open(channel.id, job.id, { ack: 'Late' })).toBe(false);
  });
});
