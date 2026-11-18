// @vitest-environment node
import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  agents,
  agentShares,
  channelJobs,
  channelThreads,
  files,
  messages,
  topics,
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
    expect(listed).toMatchObject({
      id: channel.id,
      sharedAgent: true,
      sharedAgentHandle: 'shared-helper',
    });
    expect(listed.memberAvatars).toMatchObject([{ actorType: 'agent', id: agentId }]);
    // The conversation view marks it too: its composer reads `detail`, not the list.
    expect((await visitor.detail(channel.id)).channel).toMatchObject({ sharedAgent: true });
  });

  it('lists the share id as its handle when the owner set no custom slug', async () => {
    await db
      .update(agentShares)
      .set({ shareConfig: { maxTurnsPerTopic: 2, monthlySpendLimit: 1 } })
      .where(eq(agentShares.id, shareId));
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });

    const [listed] = await visitor.list();
    expect(listed).toMatchObject({ id: channel.id, sharedAgentHandle: shareId });
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

  describe('errors a visitor sees', () => {
    const failedView = async (channelId: string, viewer: ChannelRepository) => {
      const claim = (await execution.claim(channelId, (await send(channelId, 'boom')).id, lease))!;
      await execution.fail(channelId, claim.job.id, {
        message: 'Upstream provider key sk-owner-secret rejected',
      });
      const view = await viewer.detail(channelId);
      return view!.jobs.find((job) => job.id === claim.job.id)!;
    };

    it('redacts the failure text of a shared Agent’s run, as the share page does', async () => {
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const job = await failedView(channel.id, visitor);

      expect(job.status).toBe('failed');
      expect(job.errorMessage).toBeNull();
      expect(job.errorType).toBe('AgentRuntimeError');
    });

    it('shows the raw failure when the owner’s share opts into error details', async () => {
      await db
        .update(agentShares)
        .set({ shareConfig: { maxTurnsPerTopic: 2, showErrorDetails: true } })
        .where(eq(agentShares.id, shareId));
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const job = await failedView(channel.id, visitor);

      expect(job.errorMessage).toBe('Upstream provider key sk-owner-secret rejected');
    });

    // The visitor saw "no reason recorded" when the owner's monthly cap refused the reply.
    it('keeps a spend-limit refusal readable for the visitor', async () => {
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const claim = (await execution.claim(channel.id, (await send(channel.id, 'hi')).id, lease))!;
      expect(
        await execution.retireReservation(channel.id, claim.job.id, {
          message: 'This shared Agent reached its monthly usage limit',
          type: 'ShareSpendLimitExceeded',
        }),
      ).toBe(true);
      const job = (await visitor.detail(channel.id))!.jobs.find(
        (item) => item.id === claim.job.id,
      )!;

      expect(job).toMatchObject({
        errorMessage: 'This shared Agent reached its monthly usage limit',
        errorType: 'ShareSpendLimitExceeded',
        status: 'failed',
      });
    });

    it('leaves an ordinary Agent’s failure text as it was', async () => {
      const ownAgentId = 'agt_channel_shared_own';
      await db.insert(agents).values({ id: ownAgentId, title: 'Mine', userId: visitorId });
      const { channel } = await visitor.create({ agentId: ownAgentId, title: 'Mine' });
      const job = await failedView(channel.id, visitor);

      expect(job.errorMessage).toBe('Upstream provider key sk-owner-secret rejected');
    });
  });

  describe('visitor limits', () => {
    const open = async () =>
      (await visitor.create({ agentId, sharedAgent: true, title: 'Shared Helper' })).channel;
    const sendText = (channelId: string, content: string, requestKey: string) =>
      visitor.send(channelId, { content, requestKey, routing: 'fallback' });

    it('refuses a prompt beyond the share’s length cap', async () => {
      const channel = await open();
      await expect(
        sendText(channel.id, 'x'.repeat(SHARE_VISITOR_PROMPT_MAX_LENGTH + 1), 'long'),
      ).rejects.toThrow(`limited to ${SHARE_VISITOR_PROMPT_MAX_LENGTH} characters`);
      await expect(sendText(channel.id, 'ok', 'short')).resolves.toBeDefined();
    });

    it('refuses a message that would need a topic beyond maxTopicsPerVisitor', async () => {
      await db
        .update(agentShares)
        .set({ shareConfig: { maxTopicsPerVisitor: 1, maxTurnsPerTopic: 2 } })
        .where(eq(agentShares.id, shareId));
      const channel = await open();
      const first = (await execution.claim(channel.id, (await send(channel.id, 'a')).id, lease))!;
      await execution.accepted(channel.id, first.job.id);
      await execution.saveDraft(channel.id, first.job.id, 'Answer');
      await execution.publish(channel.id, first.job.id);
      await execution.releaseWriter(channel.id, first.job.id);

      // One topic is at the cap, but it still takes a turn: the conversation continues in it.
      await expect(sendText(channel.id, 'b', 'b')).resolves.toBeDefined();

      // Once that topic is out of turns, a new one would exceed the cap.
      await db.insert(messages).values(
        ['one', 'two'].map((content) => ({
          content,
          role: 'user' as const,
          topicId: first.topic.id,
          userId: ownerId,
        })),
      );
      await expect(sendText(channel.id, 'c', 'c')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'You have reached the limit of 1 conversations with this Agent',
      });
    });

    it('judges a send by the topic its own Thread would continue', async () => {
      await db
        .update(agentShares)
        .set({ shareConfig: { maxTopicsPerVisitor: 2, maxTurnsPerTopic: 2 } })
        .where(eq(agentShares.id, shareId));
      const channel = await open();
      const settle = async (job: { id: string }) => {
        const claimed = (await execution.claim(channel.id, job.id, lease))!;
        await execution.accepted(channel.id, job.id);
        await execution.saveDraft(channel.id, job.id, 'Answer');
        await execution.publish(channel.id, job.id);
        await execution.releaseWriter(channel.id, job.id);
        return claimed.topic;
      };

      // A Thread with turns left, and a main-timeline topic, touched last, that has run out of them.
      const root = await sendText(channel.id, 'root', 'root');
      const [rootJob] = await jobsOf(db, root.id);
      const mainTopic = await settle(rootJob);
      const [thread] = await db
        .insert(channelThreads)
        .values({
          channelId: channel.id,
          followerMemberIds: [rootJob.memberId],
          rootMessageId: root.id,
          rootSequence: root.sequence,
        })
        .returning();
      const inThread = await visitor.send(channel.id, {
        content: 'In thread',
        requestKey: 'thread',
        routing: 'fallback',
        threadId: thread.id,
      });
      const threadTopic = await settle((await jobsOf(db, inThread.id))[0]);
      expect(mainTopic.id).not.toBe(threadTopic.id);
      await db.insert(messages).values(
        ['one', 'two'].map((content) => ({
          content,
          role: 'user' as const,
          topicId: mainTopic.id,
          userId: ownerId,
        })),
      );
      await db.update(topics).set({ updatedAt: new Date() }).where(eq(topics.id, mainTopic.id));

      await expect(
        visitor.send(channel.id, {
          content: 'More',
          requestKey: 'thread-more',
          routing: 'fallback',
          threadId: thread.id,
        }),
      ).resolves.toBeDefined();
      await expect(sendText(channel.id, 'main', 'main')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
    });
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

describe('a shared Agent in the visitor’s workspace', () => {
  const inWorkspace = new ChannelRepository(db, visitorId, fixture.workspaceId);

  const open = async () => {
    const { channel } = await inWorkspace.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    return channel;
  };

  it('opens a direct conversation in that workspace through the live share', async () => {
    const channel = await open();
    expect(channel).toMatchObject({ agentId, userId: visitorId, workspaceId: fixture.workspaceId });

    const [listed] = await inWorkspace.list();
    expect(listed).toMatchObject({
      id: channel.id,
      sharedAgent: true,
      sharedAgentHandle: 'shared-helper',
    });
    // Personal and workspace conversations stay apart.
    expect(await visitor.list()).toEqual([]);
  });

  it('runs as its owner in the owner’s scope, and only the run reads the conversation', async () => {
    const channel = await open();
    const message = await inWorkspace.send(channel.id, {
      content: 'Hello from the team',
      requestKey: 'ws',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);

    const claim = (await execution.claim(channel.id, job.id, lease))!;
    expect(claim.job.executionConfig).toMatchObject({
      runtime: 'native',
      share: { ownerId, shareId, workspaceId: null },
    });
    expect(claim.topic).toMatchObject({ senderId: visitorId, userId: ownerId, workspaceId: null });

    const operationId = claim.job.operationId!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, operationId));
    const page = await new ChannelHistoryRepository(db, ownerId).readMessages(operationId);
    expect(page.messages.map((item) => item.content)).toContain('Hello from the team');
    await expect(new ChannelHistoryRepository(db, ownerId).currentRun(operationId)).rejects.toThrow(
      'A shared Agent can only read its own conversation',
    );
    await expect(
      new ChannelHistoryRepository(db, visitorId, fixture.workspaceId).readMessages(operationId),
    ).rejects.toThrow('Channel operation not found');
  });

  it('refuses attachments, like a personal conversation', async () => {
    const channel = await open();
    const [file] = await db
      .insert(files)
      .values({
        fileType: 'text/plain',
        name: 'note.txt',
        size: 1,
        url: 'files/ws-note.txt',
        userId: visitorId,
        workspaceId: fixture.workspaceId,
      })
      .returning();
    await expect(
      inWorkspace.send(channel.id, {
        content: 'See file',
        fileIds: [file.id],
        requestKey: 'ws-file',
        routing: 'fallback',
      }),
    ).rejects.toThrow('Attachments cannot be sent to a shared Agent');
  });

  it('still cannot join a workspace group', async () => {
    const { channel } = await inWorkspace.create({ title: 'Group' });
    await expect(inWorkspace.addAgent(channel.id, { agentId })).rejects.toThrow('Agent not found');
  });

  it('does not mark a colleague’s workspace Agent as shared', async () => {
    const teamAgentId = 'agt_channel_shared_team';
    await db.insert(agents).values({
      id: teamAgentId,
      title: 'Team Helper',
      userId: ownerId,
      visibility: 'public',
      workspaceId: fixture.workspaceId,
    });
    const { channel } = await inWorkspace.create({ agentId: teamAgentId, title: 'Team Helper' });

    const [listed] = await inWorkspace.list();
    expect(listed).toMatchObject({ id: channel.id, sharedAgent: false, sharedAgentHandle: null });
    expect((await inWorkspace.detail(channel.id)).channel).toMatchObject({ sharedAgent: false });
  });
});
