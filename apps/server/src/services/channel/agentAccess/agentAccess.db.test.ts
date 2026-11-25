// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRepository, ChannelRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobById,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import {
  agents,
  agentShareGrants,
  agentShares,
  channelAgentGrants,
  channelMembers,
  channelMessages,
  channels,
} from '@/database/schemas';

import { wakeChannel } from '../queue';
import { reportChannelReplyFailure } from '../replyError';
import { announceAgentAccessRequests } from './card';
import { resolveAgentAccess } from './resolve';
import { AgentAccessService } from './service';

vi.mock('../queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('../notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('../mention', () => ({ notifyChannelMentions: vi.fn() }));
vi.mock('../routingConfig', () => ({ resolveChannelRoutingConfig: vi.fn() }));
// Device grants need Channels on for the Agent's owner.
vi.mock('../featureGate', () => ({
  assertChannelEnabled: vi.fn(),
  isChannelEnabled: vi.fn(async () => true),
}));
// A deployment that limits shared Agents to some providers: a Channel approval must not need it.
vi.mock('@/business/agent-share', () => ({ AGENT_SHARE_ALLOWED_PROVIDERS: ['lobehub'] }));
// The owner has no Agent Share feature: approving in a Channel must not need it.
vi.mock('@/server/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(async () => ({
    enableAgentShare: false,
    enableChannels: true,
  })),
}));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-access');
const ownerId = fixture.ownerId;
const visitorId = fixture.memberId;
const execution = new ChannelExecutionRepository(db);

beforeEach(async () => {
  vi.mocked(wakeChannel).mockClear();
  await fixture.setup();
});
afterEach(fixture.cleanup);

const claudeCode = {
  model: 'claude-code',
  provider: 'claude-code',
  runtime: 'claude-code' as const,
};

/**
 * The owner's personal group with a friend, and the owner's personal Claude Code Agent in it: the
 * friend can see it, but it is the owner's to use.
 */
const personalGroup = async () => {
  const asOwner = new ChannelRepository(db, ownerId, undefined);
  const { channel } = await asOwner.create({ title: 'Friends' });
  await fixture.addPerson(channel.id, visitorId, 'member');
  const agent = await fixture.addAgent(channel.id, 'Xiao C', claudeCode);
  const asVisitor = new ChannelRepository(db, visitorId, undefined);
  const mention = async (as: ChannelRepository, key: string) => {
    const message = await as.send(channel.id, {
      content: `@Xiao C ${key}`,
      mentions: [agent.id],
      requestKey: key,
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    return job;
  };
  return { agent, agentId: agent.agentId!, asOwner, asVisitor, channel, mention };
};

const grantsOf = (memberId: string) =>
  db.select().from(channelAgentGrants).where(eq(channelAgentGrants.memberId, memberId));

/** The owner's own direct conversation with the Agent, where its request cards go. */
const ownerCards = async (agentId: string) => {
  const [direct] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.agentId, agentId), eq(channels.userId, ownerId)));
  if (!direct) return { cards: [], directId: undefined };
  const cards = await db
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, direct.id), eq(channelMessages.kind, 'agentAccess')));
  return { cards, directId: direct.id };
};

describe('resolveAgentAccess', () => {
  it('names everything a friend lacks to use the owner’s personal CLI Agent, and nothing for its owner', async () => {
    const { agentId, channel } = await personalGroup();

    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toEqual({
      missing: ['share', 'channel', 'device'],
      ownerId,
      request: null,
      state: 'needs_grant',
      via: null,
    });
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: ownerId }),
    ).toMatchObject({ state: 'ok', via: 'own' });
  });

  it('reveals nothing of a Channel the requester is not in', async () => {
    const { agentId, channel } = await personalGroup();
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: 'stranger' }),
    ).toMatchObject({ ownerId: null, state: 'unavailable' });
  });

  it('is unavailable for a trashed Agent', async () => {
    const { agentId, channel } = await personalGroup();
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, agentId));
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toMatchObject({ state: 'unavailable' });
  });
});

// A friend @-mentioning the owner's personal Agent in the owner's group used to block the reply as
// `unavailable` ("Agent 暂不可用") forever, with no way to ask.
describe('a friend mentions the owner’s personal Agent in a group', () => {
  it('waits for the owner, who is asked on an owner-only card, and runs once they approve', async () => {
    const { agent, agentId, asOwner, asVisitor, channel, mention } = await personalGroup();
    const job = await mention(asVisitor, 'make a video');

    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    expect(await jobById(db, job.id)).toMatchObject({
      blockedCode: 'access_request_pending',
      operationId: null,
      status: 'queued',
    });
    const [request] = await grantsOf(agent.id);
    expect(request).toMatchObject({ ownerId, status: 'pending' });

    await announceAgentAccessRequests(db, channel.id);
    await announceAgentAccessRequests(db, channel.id);
    const { cards, directId } = await ownerCards(agentId);
    expect(cards).toEqual([
      expect.objectContaining({
        agentId,
        content: '[Access request] mia wants to use Xiao C in "Friends". Allow?',
        metadata: {
          agentAccess: {
            agentId,
            agentName: 'Xiao C',
            channelId: channel.id,
            channelTitle: 'Friends',
            grantId: request.id,
            missing: ['share', 'channel', 'device'],
            requesterName: 'mia',
            requesterUserId: visitorId,
          },
        },
      }),
    ]);
    // Nothing of it reaches the group, which everyone in it reads.
    const group = await asVisitor.detail(channel.id);
    expect(group.messages.some((message) => message.kind === 'agentAccess')).toBe(false);
    expect((await asOwner.detail(channel.id)).messages.map((message) => message.kind)).toEqual([
      'text',
    ]);
    // Only the owner reads the card, with its live status.
    const owned = await asOwner.detail(directId!);
    expect(
      owned.messages.find((message) => message.kind === 'agentAccess')?.agentAccess,
    ).toMatchObject({ grantId: request.id, status: 'pending' });
    await expect(asVisitor.detail(directId!)).rejects.toThrow();
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toMatchObject({ request: { id: request.id, status: 'pending' }, state: 'grant_pending' });

    await expect(
      new AgentAccessService(db, visitorId).decide(request.id, 'approve'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await new AgentAccessService(db, ownerId).decide(request.id, 'approve');
    // Idempotent.
    await new AgentAccessService(db, ownerId).decide(request.id, 'approve');
    expect(wakeChannel).toHaveBeenCalledExactlyOnceWith(channel.id);

    const [share] = await db.select().from(agentShares).where(eq(agentShares.agentId, agentId));
    expect(share.visibility).toBe('card');
    expect(share.shareConfig).toMatchObject({
      deviceAccess: 'allowlist',
      deviceAllowUserIds: [visitorId],
    });
    const [shareGrant] = await db
      .select()
      .from(agentShareGrants)
      .where(eq(agentShareGrants.shareId, share.id));
    expect(shareGrant).toMatchObject({
      revokedAt: null,
      source: { channelId: channel.id, grantId: request.id, type: 'request' },
      userId: visitorId,
    });
    expect(
      (await asOwner.detail(directId!)).messages.find((message) => message.kind === 'agentAccess')
        ?.agentAccess,
    ).toMatchObject({ status: 'approved' });

    const claim = (await execution.claim(channel.id, job.id, lease))!;
    expect(claim.job.executionConfig).toMatchObject({
      runtime: 'claude-code',
      share: { ownerId, shareId: share.id, workspaceId: null },
    });
    expect(claim.topic).toMatchObject({ senderId: visitorId, userId: ownerId });
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toMatchObject({ missing: [], state: 'ok', via: 'share' });
  });

  // Approving failed with FORBIDDEN ("Agent sharing is not enabled for this account") for an owner
  // without the Agent Share feature, so the friend's reply never ran.
  it('runs the friend’s reply after approval even though the owner cannot publish shares', async () => {
    const { agent, agentId, asVisitor, channel, mention } = await personalGroup();
    const job = await mention(asVisitor, 'no share feature');
    await execution.claim(channel.id, job.id, lease);
    const [request] = await grantsOf(agent.id);

    await expect(
      new AgentAccessService(db, ownerId).decide(request.id, 'approve'),
    ).resolves.toMatchObject({ grant: { status: 'approved' } });
    expect(wakeChannel).toHaveBeenCalledWith(channel.id);
    expect(await jobById(db, job.id)).toMatchObject({ status: 'queued' });
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.executionConfig).toMatchObject({ share: { ownerId } });
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toMatchObject({ state: 'ok', via: 'share' });
  });

  // Approving resolved the Agent's model against the share provider allowlist and refused a native
  // Agent on any other provider ("Shared agents only support models from: …").
  it('runs a native Agent on a provider shares do not allow, once approved', async () => {
    const asOwner = new ChannelRepository(db, ownerId, undefined);
    const { channel } = await asOwner.create({ title: 'Friends' });
    await fixture.addPerson(channel.id, visitorId, 'member');
    const agent = await fixture.addAgent(channel.id, 'Writer', {
      model: 'gpt-5',
      provider: 'openai',
      runtime: 'native',
    });
    const message = await new ChannelRepository(db, visitorId, undefined).send(channel.id, {
      content: '@Writer draft it',
      mentions: [agent.id],
      requestKey: 'native',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    await execution.claim(channel.id, job.id, lease);
    const [request] = await grantsOf(agent.id);

    await expect(
      new AgentAccessService(db, ownerId).decide(request.id, 'approve'),
    ).resolves.toMatchObject({ grant: { status: 'approved' } });
    const [stored] = await db.select().from(agents).where(eq(agents.id, agent.agentId!));
    // The owner's model is left as it is, not swapped for an allowed one.
    expect(stored).toMatchObject({ model: 'gpt-5', provider: 'openai' });
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.executionConfig).toMatchObject({
      model: 'gpt-5',
      provider: 'openai',
      runtime: 'native',
      share: { ownerId },
    });
    expect(
      await resolveAgentAccess(db, {
        agentId: agent.agentId!,
        channelId: channel.id,
        requesterUserId: visitorId,
      }),
    ).toMatchObject({ state: 'ok', via: 'share' });
  });

  it('refuses to approve once the Agent left the Channel', async () => {
    const { agent, asVisitor, channel, mention } = await personalGroup();
    const job = await mention(asVisitor, 'then removed');
    await execution.claim(channel.id, job.id, lease);
    const [request] = await grantsOf(agent.id);
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, agent.id));

    await expect(
      new AgentAccessService(db, ownerId).decide(request.id, 'approve'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await db.select().from(agentShares).where(eq(agentShares.agentId, agent.agentId!)),
    ).toEqual([]);
  });

  it('holds back no one who may use the Agent while the friend waits', async () => {
    const { asOwner, asVisitor, channel, mention } = await personalGroup();
    const waiting = await mention(asVisitor, 'first');
    expect(await execution.claim(channel.id, waiting.id, lease)).toBeNull();

    const own = await mention(asOwner, 'second');
    const heads = (await execution.candidates(channel.id)).heads.map((job) => job.id);
    expect(heads).toEqual(expect.arrayContaining([waiting.id, own.id]));
    expect(await execution.claim(channel.id, own.id, lease)).not.toBeNull();
    expect(await jobById(db, waiting.id)).toMatchObject({ blockedCode: 'access_request_pending' });
  });

  it('settles the reply as declined when the owner denies, and runs it once they approve a new ask', async () => {
    const { agent, agentId, asVisitor, channel, mention } = await personalGroup();
    const job = await mention(asVisitor, 'please');
    await execution.claim(channel.id, job.id, lease);
    const [request] = await grantsOf(agent.id);

    await new AgentAccessService(db, ownerId).decide(request.id, 'deny');
    await expect(
      new AgentAccessService(db, ownerId).decide(request.id, 'approve'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const denied = vi.fn();
    expect(
      await execution.claim(channel.id, job.id, { ...lease, onAccessDenied: denied }),
    ).toBeNull();
    expect(denied).toHaveBeenCalledWith(job.id);
    expect(await jobById(db, job.id)).toMatchObject({
      blockedCode: 'access_denied',
      operationId: null,
      status: 'failed',
    });
    const reported = await reportChannelReplyFailure(db, channel.id, job.id, {
      createSummarizer: false,
      notify: vi.fn(),
    });
    const [card] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, reported!.messageId));
    expect(card.metadata?.replyError).toMatchObject({
      actions: ['request_access'],
      jobId: job.id,
      summary:
        "Xiao C's owner declined your request to use it, so it did not reply. You can ask again.",
    });
    expect(
      await resolveAgentAccess(db, { agentId, channelId: channel.id, requesterUserId: visitorId }),
    ).toMatchObject({ state: 'denied' });

    // Asking again reaches the owner with a new card; their approval runs the declined reply.
    const asked = await new AgentAccessService(db, visitorId).request({
      agentId,
      channelId: channel.id,
      jobId: job.id,
    });
    expect(asked).toMatchObject({ state: 'grant_pending' });
    const again = (await grantsOf(agent.id)).find((grant) => grant.status === 'pending')!;
    expect(again.metadata).toMatchObject({ jobIds: [job.id] });
    expect((await ownerCards(agentId)).cards).toHaveLength(1);

    await new AgentAccessService(db, ownerId).decide(again.id, 'approve');
    expect(await jobById(db, job.id)).toMatchObject({ blockedCode: null, status: 'queued' });
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });
});

// A visitor DMs another person's link-shared Claude Code Agent whose device is not granted to them.
describe('a visitor asks for a shared CLI Agent’s device in their own conversation with it', () => {
  it('asks the owner, and approving grants the device to the visitor outside the address book', async () => {
    const [agent] = await db
      .insert(agents)
      .values({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        model: 'claude-code',
        provider: 'claude-code',
        title: 'LobeVideo',
        userId: ownerId,
      })
      .returning();
    await db.insert(agentShares).values({
      agentId: agent.id,
      shareConfig: { deviceAccess: 'allowlist', deviceAllowUserIds: [] },
      visibility: 'link',
    });
    const asVisitor = new ChannelRepository(db, visitorId, undefined);
    const { channel } = await asVisitor.create({
      agentId: agent.id,
      sharedAgent: true,
      title: 'LobeVideo',
    });
    const visitor = new AgentAccessService(db, visitorId);

    expect(await visitor.check({ agentId: agent.id, channelId: channel.id })).toMatchObject({
      missing: ['device'],
      state: 'needs_grant',
    });
    // Without a Channel too, on the Agent's profile.
    expect(await visitor.check({ agentId: agent.id })).toMatchObject({
      missing: ['device'],
      state: 'needs_grant',
    });

    expect(await visitor.request({ agentId: agent.id, channelId: channel.id })).toMatchObject({
      request: { status: 'pending' },
      state: 'grant_pending',
    });
    expect(await visitor.check({ agentId: agent.id })).toMatchObject({ state: 'grant_pending' });
    const { cards } = await ownerCards(agent.id);
    expect(cards).toHaveLength(1);
    const grantId = (cards[0].metadata?.agentAccess as { grantId: string }).grantId;

    await new AgentAccessService(db, ownerId).decide(grantId, 'approve');
    const [share] = await db.select().from(agentShares).where(eq(agentShares.agentId, agent.id));
    // The live link share keeps its reach; only the device is granted.
    expect(share.visibility).toBe('link');
    expect(share.shareConfig).toMatchObject({ deviceAllowUserIds: [visitorId] });
    expect(await visitor.check({ agentId: agent.id, channelId: channel.id })).toMatchObject({
      state: 'ok',
      via: 'share',
    });
    await expect(
      visitor.request({ agentId: agent.id, channelId: channel.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
