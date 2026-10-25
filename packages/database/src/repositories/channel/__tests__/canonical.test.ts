// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  agents,
  channelMembers,
  channelMessages,
  channelThreads,
  messages,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import {
  createChannelFixture,
  deviceConfig,
  jobById,
  jobsOf,
  lease,
  nativeConfig,
  operationById,
} from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-canonical');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async (config = nativeConfig) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Agent', config);
  let counter = 0;
  const claim = async (owner = false, threadId?: string) => {
    const message = await (owner ? team.asOwner : team.asMember).send(team.channel.id, {
      content: `Request ${++counter}`,
      mentions: [agent.id],
      requestKey: `request-${counter}`,
      routing: 'fallback',
      threadId,
    });
    const [job] = await jobsOf(db, message.id);
    return (await execution.claim(team.channel.id, job.id, lease))!;
  };
  const finish = async ({ job }: Awaited<ReturnType<typeof claim>>) => {
    await execution.accepted(team.channel.id, job.id, {});
    await execution.saveDraft(team.channel.id, job.id, 'Final answer');
    await execution.releaseWriter(team.channel.id, job.id);
  };
  return { ...team, agent, claim, finish };
};

const operationOf = (id: string | null) => operationById(db, id);

describe('canonical channel persistence', () => {
  it('attributes operations to the member Agent reference', async () => {
    const team = await setup();
    const [source] = await db
      .insert(agents)
      .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    await db
      .update(channelMembers)
      .set({ agentId: source.id })
      .where(eq(channelMembers.id, team.agent.id));

    const claim = await team.claim();

    expect(await operationOf(claim.job.operationId)).toMatchObject({
      agentId: source.id,
      userId: fixture.memberId,
    });
  });

  it.each([nativeConfig, deviceConfig()])(
    'creates an operation with the actual requester for $runtime',
    async (config) => {
      const team = await setup(config);
      const claim = await team.claim();
      expect(claim.topic).toMatchObject({
        userId: fixture.memberId,
        agentId: team.agent.agentId,
        mode: 'default',
        trigger: 'channel',
      });
      expect(await operationOf(claim.job.operationId)).toMatchObject({
        userId: fixture.memberId,
        workspaceId: fixture.workspaceId,
        topicId: claim.topic.id,
        model: config.model,
        provider: config.provider,
        trigger: 'channel',
      });
      expect(claim.job.operationId).toMatch(/^op_/);
    },
  );

  it('reuses the topic and supplies only new public input after a completed run', async () => {
    const team = await setup();
    const first = await team.claim();
    await db.insert(messages).values({
      topicId: first.topic.id,
      userId: fixture.memberId,
      role: 'assistant',
      content: 'PRIVATE transcript',
    });
    await team.finish(first);
    expect((await operationOf(first.job.operationId)).status).toBe('done');
    // Physical release may precede publication, and only the saved final answer is published.
    await execution.publish(team.channel.id, first.job.id);

    const second = await team.claim();
    expect(second.topic.id).toBe(first.topic.id);
    expect(
      (await execution.input(team.channel.id, second.job.id)).map((message) => message.content),
    ).toEqual(['Request 2']);

    await execution.accepted(team.channel.id, first.job.id, {});
    await execution.fail(team.channel.id, first.job.id, { message: 'Late failure' });
    expect((await operationOf(first.job.operationId)).status).toBe('done');
    expect((await jobById(db, first.job.id)).status).toBe('completed');
  });

  it.each(['other requester', 'deleted topic', 'branch'])(
    'starts the next run (%s) in a new topic and preserves old run identity',
    async (reason) => {
      const team = await setup();
      const first = await team.claim();
      await team.finish(first);
      if (reason === 'deleted topic') await db.delete(topics).where(eq(topics.id, first.topic.id));
      let threadId: string | undefined;
      if (reason === 'branch') {
        const [thread] = await db
          .insert(channelThreads)
          .values({
            channelId: team.channel.id,
            rootMessageId: first.job.messageId,
            rootSequence: 1,
            followerMemberIds: [team.agent.id],
          })
          .returning();
        threadId = thread.id;
      }

      const second = await team.claim(reason === 'other requester', threadId);

      expect(second.topic.id).not.toBe(first.topic.id);
      expect(second.topic.userId).toBe(
        reason === 'other requester' ? fixture.ownerId : fixture.memberId,
      );
      expect((await operationOf(first.job.operationId)).topicId).toBe(
        reason === 'deleted topic' ? null : first.topic.id,
      );
    },
  );

  it('merges the hetero resume id into the run topic metadata', async () => {
    const team = await setup(deviceConfig());
    const claim = await team.claim();
    await db
      .update(topics)
      .set({ metadata: { model: 'preserved-model' } })
      .where(eq(topics.id, claim.topic.id));

    await execution.accepted(team.channel.id, claim.job.id, { nativeSessionId: 'cli-resume' });

    const [topic] = await db.select().from(topics).where(eq(topics.id, claim.topic.id));
    expect(topic.metadata).toMatchObject({
      model: 'preserved-model',
      heteroSessionId: 'cli-resume',
    });
  });

  it('does not create an operation for a blocked directory claim', async () => {
    const first = await setup(deviceConfig());
    await first.claim();
    const second = await setup(deviceConfig());
    expect(await second.claim()).toBeNull();
    expect(
      await db
        .select()
        .from(agentOperations)
        .where(eq(agentOperations.agentId, second.agent.agentId!)),
    ).toHaveLength(0);
    expect(
      await db.select().from(topics).where(eq(topics.agentId, second.agent.agentId!)),
    ).toHaveLength(0);
  });

  it('preserves the public timeline when its creator account is deleted', async () => {
    const team = await setup();
    const claim = await team.claim(true);
    await db
      .update(workspaces)
      .set({ primaryOwnerId: fixture.memberId })
      .where(eq(workspaces.id, fixture.workspaceId));
    await db.delete(users).where(eq(users.id, fixture.ownerId));
    expect(
      await db.select().from(channelMessages).where(eq(channelMessages.id, claim.job.messageId)),
    ).toHaveLength(1);
  });

  it('does not resurrect an operation already completed by the runtime', async () => {
    const team = await setup();
    const claim = await team.claim();
    await db
      .update(agentOperations)
      .set({ status: 'done', totalTokens: 42, traceS3Key: 'trace' })
      .where(eq(agentOperations.id, claim.job.operationId!));
    await execution.accepted(team.channel.id, claim.job.id, {});
    await execution.fail(team.channel.id, claim.job.id, { message: 'late' });
    expect(await jobById(db, claim.job.id)).toMatchObject({
      acceptedAt: expect.any(Date),
      publicationRevoked: false,
      status: 'running',
    });
    expect(await operationOf(claim.job.operationId)).toMatchObject({
      status: 'done',
      totalTokens: 42,
      traceS3Key: 'trace',
    });
  });
});
