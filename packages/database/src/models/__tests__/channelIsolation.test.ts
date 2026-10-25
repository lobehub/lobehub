// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ChannelExecutionRepository, ChannelRepository } from '../../repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '../../repositories/channel/__tests__/testUtils';
import { agentOperations, channelMessages, channels, topics } from '../../schemas';
import { AgentOperationModel } from '../agentOperation';
import { MessageModel } from '../message';
import { TopicModel } from '../topic';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-boundary');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const repository = new ChannelRepository(db, fixture.ownerId);
  const { channel } = await repository.create({ title: 'Personal channel' });
  const agent = await fixture.addAgent(channel.id, 'Agent');
  const publicMessage = await repository.send(channel.id, {
    content: 'Public request',
    mentions: [agent.id],
    requestKey: 'request',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, publicMessage.id);
  const execution = new ChannelExecutionRepository(db);
  const claim = (await execution.claim(channel.id, job.id, lease))!;
  const runtime = new MessageModel(db, fixture.ownerId);
  const internal = await runtime.create({
    content: 'Internal execution',
    role: 'assistant',
    agentId: agent.agentId!,
    topicId: claim.topic.id,
  });
  return { agent, channel, claim, execution, internal, publicMessage, runtime };
};

describe('Channel source and ordinary conversation boundaries', () => {
  it('uses ordinary topic, message and operation APIs for authorized execution details', async () => {
    const state = await setup();
    expect(await state.runtime.findById(state.internal.id)).toMatchObject({
      content: 'Internal execution',
    });
    expect(await new TopicModel(db, fixture.ownerId).findById(state.claim.topic.id)).toMatchObject({
      agentId: state.agent.agentId,
      trigger: 'channel',
      userId: fixture.ownerId,
    });
    expect(
      await new AgentOperationModel(db, fixture.ownerId).findById(state.claim.job.operationId!),
    ).toMatchObject({ topicId: state.claim.topic.id });
    expect(await state.runtime.findById(state.publicMessage.id)).toBeUndefined();
    expect(
      (await state.execution.input(state.channel.id, state.claim.job.id)).map((m) => m.content),
    ).toEqual(['Public request']);
  });

  it('does not grant conversation access through a Channel membership', async () => {
    const state = await setup();
    await fixture.addPerson(state.channel.id, fixture.memberId, 'member');
    const other = new MessageModel(db, fixture.memberId);
    expect(await other.findById(state.internal.id)).toBeUndefined();
    expect(await other.update(state.internal.id, { content: 'forged' })).toEqual({
      success: false,
    });
    expect(
      await new TopicModel(db, fixture.memberId).findById(state.claim.topic.id),
    ).toBeUndefined();
    expect(
      await new AgentOperationModel(db, fixture.memberId).findById(state.claim.job.operationId!),
    ).toBeNull();
    expect(
      await new TopicModel(db, fixture.ownerId, fixture.workspaceId).findById(state.claim.topic.id),
    ).toBeUndefined();
  });

  it('keeps public history after deleting an internal topic, and keeps execution history after deleting the Channel', async () => {
    const state = await setup();
    await db.delete(topics).where(eq(topics.id, state.claim.topic.id));
    expect(
      await db.select().from(channelMessages).where(eq(channelMessages.id, state.publicMessage.id)),
    ).toHaveLength(1);
    const next = await setup();
    await db.delete(channels).where(eq(channels.id, next.channel.id));
    expect(await next.runtime.findById(next.internal.id)).toBeDefined();
    expect(await new TopicModel(db, fixture.ownerId).findById(next.claim.topic.id)).toBeDefined();
  });

  it('initializes a reserved operation only for the same principal, topic and Agent, without resurrecting completed work', async () => {
    const state = await setup();
    const params = {
      agentId: state.agent.agentId,
      operationId: state.claim.job.operationId!,
      topicId: state.claim.topic.id,
    };
    const owner = new AgentOperationModel(db, fixture.ownerId);
    const read = async () =>
      (
        await db.select().from(agentOperations).where(eq(agentOperations.id, params.operationId))
      )[0];
    await new AgentOperationModel(db, fixture.memberId).recordStart(params);
    await new AgentOperationModel(db, fixture.ownerId, fixture.workspaceId).recordStart(params);
    await owner.recordStart({ ...params, agentId: null });
    const [otherTopic] = await db.insert(topics).values({ userId: fixture.ownerId }).returning();
    await owner.recordStart({ ...params, topicId: otherTopic.id });
    expect((await read()).status).toBe('idle');
    await owner.recordStart({ ...params, maxSteps: 20 });
    expect(await read()).toMatchObject({ status: 'running', maxSteps: 20 });
    await owner.recordCompletion(params.operationId, { status: 'done', totalTokens: 123 });
    await owner.recordStart(params);
    expect(await read()).toMatchObject({ status: 'done', totalTokens: 123 });
  });
});
