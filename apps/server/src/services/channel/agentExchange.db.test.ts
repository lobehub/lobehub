// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRepository, ChannelRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import {
  agentOperations,
  channelMembers,
  channelMessages,
  channels,
  workspaceMembers,
} from '@/database/schemas';

import { reportAgentExchange } from './agentExchange';
import { ChannelMessagingService } from './ChannelMessagingService';

vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./mention', () => ({ notifyChannelMentions: vi.fn() }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: vi.fn() }));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-exchange');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.ownerId });
});
afterEach(fixture.cleanup);

const messagesIn = (channelId: string) =>
  db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.channelId, channelId))
    .orderBy(channelMessages.sequence);

/** Claims the one job of a message, marks its operation live, and returns that operation. */
const start = async (channelId: string, messageId: string) => {
  const [job] = await jobsOf(db, messageId);
  const claim = (await execution.claim(channelId, job.id, lease))!;
  await db
    .update(agentOperations)
    .set({ status: 'running' })
    .where(eq(agentOperations.id, claim.job.operationId!));
  return { job, operationId: claim.job.operationId! };
};

const finish = async (channelId: string, jobId: string, content: string) => {
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, content);
  const replyMessageId = await execution.publish(channelId, jobId);
  await execution.releaseWriter(channelId, jobId);
  return replyMessageId;
};

/**
 * The owner talks to the Asker in "Origin" and to the Answerer in its own conversation; the
 * owner's request is running in "Origin" when the Asker decides to ask the Answerer.
 */
const setup = async () => {
  const asOwner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel: origin } = await asOwner.create({ title: 'Origin' });
  const asker = await fixture.addAgent(origin.id, 'Asker');
  const { channel: elsewhere } = await asOwner.create({ title: 'Answerer home' });
  const answererMember = await fixture.addAgent(elsewhere.id, 'Answerer');
  const direct = await asOwner.create({
    agentConfig: {},
    agentId: answererMember.agentId!,
    title: 'Answerer',
  });

  const request = await asOwner.send(origin.id, {
    content: '@Asker ask the Answerer whether T-1 is fixed',
    mentions: [asker.id],
    requestKey: 'person-request',
    routing: 'fallback',
  });
  const askerRun = await start(origin.id, request.id);
  const messaging = new ChannelMessagingService(
    db,
    fixture.ownerId,
    askerRun.operationId,
    fixture.workspaceId,
  );
  return { answerer: answererMember, asker, askerRun, direct, messaging, origin };
};

describe('An Agent asking an Agent in its own conversation', () => {
  it("asks between the two Agents and posts the Agent's conclusion back where it asked", async () => {
    const { answerer, asker, askerRun, direct, messaging, origin } = await setup();

    const sent = await messaging.sendMessage(
      { agentIds: [answerer.agentId!], channelId: direct.channel.id, content: 'Is T-1 fixed?' },
      'call-1',
    );

    // Nothing lands in either conversation the person has with an Agent.
    expect(await messagesIn(direct.channel.id)).toEqual([]);
    const [pair] = await db.select().from(channels).where(eq(channels.id, sent.channelId));
    expect(pair.agentPairKey).toBe([asker.agentId, answerer.agentId].sort().join(':'));
    const [ask] = await messagesIn(pair.id);
    expect(ask).toMatchObject({
      agentId: asker.agentId,
      content: '@Answerer Is T-1 fixed?',
      metadata: { exchange: { hops: 1, origin: { channelId: origin.id, threadId: null } } },
      userId: null,
    });
    // Retrying the same tool call returns the same message.
    const again = await messaging.sendMessage(
      { agentIds: [answerer.agentId!], channelId: direct.channel.id, content: 'Is T-1 fixed?' },
      'call-1',
    );
    expect(again.messageId).toBe(sent.messageId);
    await finish(origin.id, askerRun.job.id, 'Asked the Answerer; I will report back.');

    // The Answerer answers between the Agents, which wakes the Asker there.
    const answering = await start(pair.id, ask.id);
    const answerId = await finish(pair.id, answering.job.id, 'Not yet: no PR');
    await reportAgentExchange(db, {
      channelId: pair.id,
      jobId: answering.job.id,
      replyMessageId: answerId,
    });
    expect(await execution.deliverAnswerToAsker(pair.id, answerId)).toBe(true);

    const concluding = await start(pair.id, answerId);
    const conclusionId = await finish(pair.id, concluding.job.id, 'T-1 is not fixed yet.');
    const params = { channelId: pair.id, jobId: concluding.job.id, replyMessageId: conclusionId };
    await reportAgentExchange(db, params);
    await reportAgentExchange(db, params);

    const reported = (await messagesIn(origin.id)).filter(
      (message) => message.requestKey === `agent-exchange:${conclusionId}`,
    );
    expect(reported).toEqual([
      expect.objectContaining({
        agentId: asker.agentId,
        content: 'T-1 is not fixed yet.',
        metadata: {
          receipt: { channelId: pair.id, channelTitle: pair.title, messageId: conclusionId },
        },
        routingStatus: 'reply',
        userId: null,
      }),
    ]);
    // No message in the person's conversation is written as the person, and none wakes anyone.
    const originMessages = await messagesIn(origin.id);
    expect(originMessages.filter((message) => message.userId)).toHaveLength(1);
    expect(await jobsOf(db, reported[0].id)).toEqual([]);
  });

  it('lets the Asker ask again from the exchange, up to the limit', async () => {
    const { answerer, direct, messaging } = await setup();
    const sent = await messaging.sendMessage(
      { agentIds: [answerer.agentId!], channelId: direct.channel.id, content: 'First?' },
      'call-1',
    );
    const [ask] = await messagesIn(sent.channelId);
    const answering = await start(sent.channelId, ask.id);
    const answerId = await finish(sent.channelId, answering.job.id, 'Need more detail');
    await execution.deliverAnswerToAsker(sent.channelId, answerId);
    const concluding = await start(sent.channelId, answerId);

    const followUp = await new ChannelMessagingService(
      db,
      fixture.ownerId,
      concluding.operationId,
      fixture.workspaceId,
    ).sendMessage(
      { agentIds: [answerer.agentId!], channelId: sent.channelId, content: 'It is in parser.ts' },
      'call-2',
    );
    const [message] = await db
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, sent.channelId),
          eq(channelMessages.id, followUp.messageId),
        ),
      );
    expect(followUp.channelId).toBe(sent.channelId);
    expect(message.metadata).toMatchObject({ exchange: { hops: 2 } });
  });

  it("refuses to relay again from the answering Agent's run", async () => {
    const { answerer, direct, messaging } = await setup();
    const sent = await messaging.sendMessage(
      { agentIds: [answerer.agentId!], channelId: direct.channel.id, content: 'First?' },
      'call-1',
    );
    const [ask] = await messagesIn(sent.channelId);
    const answering = await start(sent.channelId, ask.id);
    const [askerMember] = await db
      .select()
      .from(channelMembers)
      .where(
        and(eq(channelMembers.channelId, sent.channelId), eq(channelMembers.agentId, ask.agentId!)),
      );

    await expect(
      new ChannelMessagingService(
        db,
        fixture.ownerId,
        answering.operationId,
        fixture.workspaceId,
      ).sendMessage(
        { agentIds: [askerMember.agentId!], channelId: sent.channelId, content: 'Back to you' },
        'call-3',
      ),
    ).rejects.toThrow(/Another Agent asked you this/);
  });
});
