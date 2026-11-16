// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  agents,
  agentShares,
  channelJobs,
  files,
  messages,
  userContacts,
  userSettings,
} from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease, operationById } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-shared-agent');
const execution = new ChannelExecutionRepository(db);

// The fixture's member is the visitor; its owner shares an Agent.
const visitorId = fixture.memberId;
const ownerId = fixture.ownerId;
const agentId = 'agt_channel_shared';
const visitor = new ChannelRepository(db, visitorId);

let shareId: string;

beforeEach(async () => {
  await fixture.setup();
  await db.insert(agents).values({
    id: agentId,
    model: 'owner-model',
    provider: 'owner-provider',
    systemRole: 'Owner prompt',
    title: 'Shared Helper',
    userId: ownerId,
  });
  const [share] = await db
    .insert(agentShares)
    .values({
      agentId,
      shareConfig: { maxTurnsPerTopic: 2, monthlySpendLimit: 1, slug: 'shared-helper' },
      visibility: 'link',
    })
    .returning();
  shareId = share.id;
});

afterEach(async () => {
  await db.delete(userContacts);
  // Users cascade their Agents and topics once the fixture has released its writers.
  await fixture.cleanup();
});

const send = async (channelId: string, requestKey: string) => {
  const message = await visitor.send(channelId, {
    content: `Request ${requestKey}`,
    requestKey,
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, message.id);
  return job;
};

describe('a contact’s shared Agent in a direct conversation', () => {
  it('opens through the live share without a contact entry, but never from a bare Agent id', async () => {
    await expect(visitor.create({ agentId, title: 'Shared Helper' })).rejects.toThrow(
      'Agent not found',
    );
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    expect(channel).toMatchObject({ agentId, userId: visitorId, workspaceId: null });

    const [listed] = await visitor.list();
    expect(listed).toMatchObject({ id: channel.id, sharedAgent: true });
    expect(listed.memberAvatars).toMatchObject([{ actorType: 'agent', id: agentId }]);
  });

  it('cannot be added to a group', async () => {
    const { channel } = await visitor.create({ title: 'Group' });
    await expect(visitor.addAgent(channel.id, { agentId })).rejects.toThrow('Agent not found');
  });

  it('runs as its owner, on an owner topic tagged with the visitor', async () => {
    await db.insert(userSettings).values([
      { defaultAgent: { config: { params: { temperature: 0.1 } } }, id: ownerId },
      { defaultAgent: { config: { params: { temperature: 0.9 } } }, id: visitorId },
    ]);
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    const job = await send(channel.id, 'first');

    const claim = (await execution.claim(channel.id, job.id, lease))!;
    expect(claim.job.executionConfig).toMatchObject({
      model: 'owner-model',
      params: { temperature: 0.1 },
      runtime: 'native',
      share: { ownerId, shareId, workspaceId: null },
      systemRole: 'Owner prompt',
    });
    expect(claim.job.executionConfig?.deviceId).toBeUndefined();
    expect(claim.topic).toMatchObject({ senderId: visitorId, userId: ownerId, workspaceId: null });
    expect(await operationById(db, claim.job.operationId)).toMatchObject({
      topicId: claim.topic.id,
      userId: ownerId,
    });
  });

  it('is blocked once the owner pauses the share', async () => {
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    await db.update(agentShares).set({ visibility: 'private' }).where(eq(agentShares.id, shareId));
    const job = await send(channel.id, 'paused');

    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    const [blocked] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
    expect(blocked.blockedCode).toBe('unavailable');
  });

  it('refuses attachments, which the owner’s run could not read', async () => {
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    const [file] = await db
      .insert(files)
      .values({
        fileType: 'text/plain',
        name: 'note.txt',
        size: 1,
        url: 'files/note.txt',
        userId: visitorId,
      })
      .returning();
    await expect(
      visitor.send(channel.id, {
        content: 'See file',
        fileIds: [file.id],
        requestKey: 'file',
        routing: 'fallback',
      }),
    ).rejects.toThrow('Attachments cannot be sent to a shared Agent');
  });

  it('continues its topic until the share’s per-topic turn limit', async () => {
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    const claim = async (key: string) =>
      (await execution.claim(channel.id, (await send(channel.id, key)).id, lease))!;
    const finish = async (jobId: string) => {
      await execution.accepted(channel.id, jobId);
      await execution.saveDraft(channel.id, jobId, 'Answer');
      await execution.publish(channel.id, jobId);
      await execution.releaseWriter(channel.id, jobId);
    };

    const first = await claim('a');
    await finish(first.job.id);
    const second = await claim('b');
    expect(second.topic.id).toBe(first.topic.id);

    // Two visitor turns reach `maxTurnsPerTopic: 2`.
    await db.insert(messages).values(
      ['one', 'two'].map((content) => ({
        content,
        role: 'user' as const,
        topicId: first.topic.id,
        userId: ownerId,
      })),
    );
    await finish(second.job.id);
    const third = await claim('c');
    expect(third.topic.id).not.toBe(first.topic.id);
    expect(third.topic).toMatchObject({ senderId: visitorId, userId: ownerId });
  });

  describe('reading its conversation history', () => {
    const start = async () => {
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      // An earlier exchange, answered and settled, then the live run.
      const earlier = await visitor.send(channel.id, {
        content: 'Earlier note',
        requestKey: 'earlier',
        routing: 'fallback',
      });
      const [earlierJob] = await jobsOf(db, earlier.id);
      await execution.claim(channel.id, earlierJob.id, lease);
      await execution.accepted(channel.id, earlierJob.id);
      await execution.saveDraft(channel.id, earlierJob.id, 'Earlier answer');
      await execution.publish(channel.id, earlierJob.id);
      await execution.releaseWriter(channel.id, earlierJob.id);
      const first = (await execution.claim(channel.id, (await send(channel.id, 'now')).id, lease))!;
      await db
        .update(agentOperations)
        .set({ status: 'running' })
        .where(eq(agentOperations.id, first.job.operationId!));
      return { channel, operationId: first.job.operationId! };
    };

    it('lets the run, as its owner, read the visitor’s public conversation', async () => {
      const { operationId } = await start();
      const history = new ChannelHistoryRepository(db, ownerId);
      const page = await history.readMessages(operationId);
      expect(page.messages.map((message) => message.content)).toContain('Earlier note');
    });

    it('refuses anything that would act in the owner’s Channels', async () => {
      const { operationId } = await start();
      await expect(
        new ChannelHistoryRepository(db, ownerId).currentRun(operationId),
      ).rejects.toThrow('A shared Agent can only read its own conversation');
    });

    it('does not open the run to the visitor or to another scope', async () => {
      const { operationId } = await start();
      await expect(
        new ChannelHistoryRepository(db, visitorId).readMessages(operationId),
      ).rejects.toThrow('Channel operation not found');
      await expect(
        new ChannelHistoryRepository(db, ownerId, fixture.workspaceId).readMessages(operationId),
      ).rejects.toThrow('Channel operation not found');
    });
  });
});
