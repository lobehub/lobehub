// @vitest-environment node
import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  agents,
  agentShares,
  channelJobs,
  files,
  messages,
  topics,
  userContacts,
  userSettings,
} from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository, ChannelRepository } from '..';
import { tableContacts } from './tableContacts';
import { createChannelFixture, jobsOf, lease, operationById } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-shared-agent', tableContacts);
const execution = new ChannelExecutionRepository(db);

// The fixture's member is the visitor; its owner shares an Agent.
const visitorId = fixture.memberId;
const ownerId = fixture.ownerId;
const agentId = 'agt_channel_shared';
const visitor = new ChannelRepository(db, visitorId, undefined, tableContacts);

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
      shareConfig: { monthlySpendLimit: 1, slug: 'shared-helper' },
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
    // The conversation view marks it too: its composer reads `detail`, not the list, and a refused
    // reply offers its owner's contact card.
    const detail = await visitor.detail(channel.id);
    expect(detail.channel).toMatchObject({ sharedAgent: true });
    expect(detail.sharedAgentOwner).toMatchObject({ id: ownerId });
  });

  it('lists the share id as its handle when the owner set no custom slug', async () => {
    await db
      .update(agentShares)
      .set({ shareConfig: { monthlySpendLimit: 1 } })
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

  it('names its share to the reply opener, which must admit the request first', async () => {
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    const job = await send(channel.id, 'first');

    expect(await execution.openingCandidate(channel.id, job.id)).toMatchObject({
      request: { content: 'Request first' },
      requesterUserId: visitorId,
      share: { ownerId, shareId, workspaceId: null },
    });
  });

  // The runtimes its share page runs. Whether the share grants the owner's device is the run's
  // share gate's call, so the claim leaves the device unset either way.
  it('runs a Claude Code or Codex Agent, as its share page does', async () => {
    const { channel } = await visitor.create({
      agentId,
      sharedAgent: true,
      title: 'Shared Helper',
    });
    for (const type of ['claude-code', 'codex'] as const) {
      await db
        .update(agents)
        .set({ agencyConfig: { heterogeneousProvider: { command: type, type } } })
        .where(eq(agents.id, agentId));
      const job = await send(channel.id, type);
      const claim = (await execution.claim(channel.id, job.id, lease))!;
      expect(claim.job.executionConfig).toMatchObject({
        runtime: type,
        share: { ownerId, shareId, workspaceId: null },
      });
      expect(claim.job.executionConfig?.deviceId).toBeUndefined();
      await execution.retireReservation(channel.id, job.id);
    }
  });

  // The run uses the owner's device, so its presence is the owner's: asking about the visitor
  // left every visitor waiting for a device that was online.
  it.each(['claude-code', 'kimi-code'])(
    "checks the owner's routed %s device as the owner, in the owner's scope",
    async (type) => {
      await db
        .update(agents)
        .set({
          agencyConfig: {
            boundDeviceId: 'owner-device',
            executionTarget: 'device',
            heterogeneousProvider: { command: type, type },
          },
        })
        .where(eq(agents.id, agentId));
      const { channel } = await new ChannelRepository(
        db,
        visitorId,
        fixture.workspaceId,
        tableContacts,
      ).create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const message = await new ChannelRepository(
        db,
        visitorId,
        fixture.workspaceId,
        tableContacts,
      ).send(channel.id, { content: 'Hello', requestKey: 'routed', routing: 'fallback' });
      const [job] = await jobsOf(db, message.id);
      const routedDevice = vi.fn(async () => ({ deviceId: 'owner-device', online: true }));

      const claim = await execution.claim(channel.id, job.id, {
        ...lease,
        onlineDeviceIds: [],
        routedDevice,
      });
      expect(routedDevice).toHaveBeenCalledWith(
        expect.objectContaining({ agentId, userId: ownerId, workspaceId: null }),
      );
      expect(claim?.job).toMatchObject({ blockedCode: null });
    },
  );

  it.each(['openclaw', 'hermes'])(
    'is blocked for the remote %s runtime its share page cannot run',
    async (type) => {
      await db
        .update(agents)
        .set({ agencyConfig: { heterogeneousProvider: { command: type, type } } })
        .where(eq(agents.id, agentId));
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const job = await send(channel.id, type);

      expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
      const [blocked] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
      expect(blocked.blockedCode).toBe('unavailable');
    },
  );

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

  it('keeps continuing its topic however many messages it holds', async () => {
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

    // Message count never rolls the topic over; only the staleness window does.
    await db.insert(messages).values(
      ['one', 'two', 'three', 'four', 'five'].map((content) => ({
        content,
        role: 'user' as const,
        topicId: first.topic.id,
        userId: ownerId,
      })),
    );
    await finish(second.job.id);
    const third = await claim('c');
    expect(third.topic.id).toBe(first.topic.id);
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

    // The share option to show visitors raw errors was removed; a row written before then
    // must not bring it back.
    it('still redacts the failure when a stored share config predates the removed error-details option', async () => {
      await db
        .update(agentShares)
        .set({ shareConfig: { showErrorDetails: true } as Record<string, unknown> })
        .where(eq(agentShares.id, shareId));
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const job = await failedView(channel.id, visitor);

      expect(job.errorMessage).toBeNull();
      expect(job.errorType).toBe('AgentRuntimeError');
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

    // A failure recording only its type skipped redaction, so the visitor read the owner's
    // budget state from the raw type.
    it('redacts a failure that records only its type', async () => {
      const { channel } = await visitor.create({
        agentId,
        sharedAgent: true,
        title: 'Shared Helper',
      });
      const claim = (await execution.claim(
        channel.id,
        (await send(channel.id, 'bare')).id,
        lease,
      ))!;
      await execution.fail(channel.id, claim.job.id, { message: 'unused' });
      await db
        .update(agentOperations)
        .set({ error: { type: 'InsufficientBudgetForModel' } })
        .where(eq(agentOperations.id, claim.job.operationId!));
      const job = (await visitor.detail(channel.id))!.jobs.find(
        (item) => item.id === claim.job.id,
      )!;

      expect(job.errorMessage).toBeNull();
      expect(job.errorType).toBe('AgentRuntimeError');
    });

    it('leaves an ordinary Agent’s failure text as it was', async () => {
      const ownAgentId = 'agt_channel_shared_own';
      await db.insert(agents).values({ id: ownAgentId, title: 'Mine', userId: visitorId });
      const { channel } = await visitor.create({ agentId: ownAgentId, title: 'Mine' });
      const job = await failedView(channel.id, visitor);

      expect(job.errorMessage).toBe('Upstream provider key sk-owner-secret rejected');
    });
  });

  // Every share limit refuses the reply when it is dispatched, never the send, so the visitor's
  // message stays and its failed reply explains the limit, after a reload too.
  describe('visitor limits', () => {
    const open = async () =>
      (await visitor.create({ agentId, sharedAgent: true, title: 'Shared Helper' })).channel;
    const sendText = (channelId: string, content: string, requestKey: string) =>
      visitor.send(channelId, { content, requestKey, routing: 'fallback' });

    it('sends a prompt beyond the share’s length cap, queuing its reply', async () => {
      const channel = await open();
      const message = await sendText(
        channel.id,
        'x'.repeat(SHARE_VISITOR_PROMPT_MAX_LENGTH + 1),
        'long',
      );

      expect(await jobsOf(db, message.id)).toHaveLength(1);
    });

    it('sends past maxMessagesPerVisitor, queuing its reply', async () => {
      await db
        .update(agentShares)
        .set({ shareConfig: { maxMessagesPerVisitor: 1 } })
        .where(eq(agentShares.id, shareId));
      const channel = await open();
      const [topic] = await db
        .insert(topics)
        .values({ agentId, senderId: visitorId, userId: ownerId })
        .returning();
      await db
        .insert(messages)
        .values({ content: 'one', role: 'user', topicId: topic.id, userId: ownerId });
      const message = await sendText(channel.id, 'two', 'two');

      expect(await jobsOf(db, message.id)).toHaveLength(1);
    });

    it.each(['ShareMessageLimitExceeded', 'SharePromptTooLong', 'ShareSpendLimitExceeded'])(
      'keeps the %s refusal of its reply readable after a reload',
      async (type) => {
        const channel = await open();
        const claim = (await execution.claim(
          channel.id,
          (await send(channel.id, 'hi')).id,
          lease,
        ))!;
        await execution.retireReservation(channel.id, claim.job.id, { message: 'Readable', type });
        const job = (await visitor.detail(channel.id))!.jobs.find(
          (item) => item.id === claim.job.id,
        )!;

        expect(job).toMatchObject({ errorMessage: 'Readable', errorType: type, status: 'failed' });
      },
    );
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
  const inWorkspace = new ChannelRepository(db, visitorId, fixture.workspaceId, tableContacts);

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
    expect(listed).toMatchObject({
      id: channel.id,
      sharedAgent: false,
      sharedAgentHandle: null,
    });
    const teamDetail = await inWorkspace.detail(channel.id);
    expect(teamDetail.channel).toMatchObject({ sharedAgent: false });
    expect(teamDetail.sharedAgentOwner).toBeNull();

    // Its link share does not limit a colleague, who runs it as their own: the reply opens freely.
    await db.insert(agentShares).values({ agentId: teamAgentId, visibility: 'link' });
    const message = await inWorkspace.send(channel.id, {
      content: 'Hello team',
      requestKey: 'team',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const candidate = await execution.openingCandidate(channel.id, job.id);
    expect(candidate).toBeDefined();
    expect(candidate?.share).toBeUndefined();
  });
});
