// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { ChannelExecutionRepository, ChannelRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import {
  agentOperations,
  agents,
  agentShares,
  channelAgentGrants,
  channelJobs,
  channelMessages,
  channels,
  topics,
  workspaceMembers,
} from '@/database/schemas';

import { ChannelPostService } from './ChannelPostService';
import { unpostedRunSurfaces } from './runSurfaces';

/**
 * An Agent answering in a Thread posts as itself on the main timeline, another Thread or another
 * Channel, with the cards its run drew. Real: the Channel repositories and models on PGlite.
 * Faked: the gateway nudge and the feature gate.
 */

vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-post-message');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.ownerId });
});
afterEach(fixture.cleanup);

const card = {
  catalogId: 'https://lobehub.com/a2ui/catalog/v1',
  fallback: 'Weekly report · 12 done',
  operations: [{ createSurface: { surfaceId: 'weekly' }, version: '1.0' }],
  surfaceId: 'weekly',
  version: '1.0',
};

/**
 * The owner asks the Reporter in a Thread of "Team"; its run is live, with its own Topic.
 * Returns the run's operation and where it answers.
 */
const setup = async () => {
  const team = await fixture.createTeamChannel();
  const reporter = await fixture.addAgent(team.channel.id, 'Reporter');
  const root = await team.asOwner.send(team.channel.id, {
    content: 'Weekly report',
    requestKey: 'root',
    routing: 'fallback',
  });
  // Only the Thread's request is under test; whatever the root woke stays out of the way.
  await db
    .update(channelJobs)
    .set({ status: 'cancelled' })
    .where(eq(channelJobs.channelId, team.channel.id));
  const thread = await team.asOwner.createThread(team.channel.id, { rootMessageId: root.id });
  const request = await team.asOwner.send(team.channel.id, {
    content: '@Reporter write it up',
    mentions: [reporter.id],
    requestKey: 'thread-request',
    routing: 'decision',
    threadId: thread.id,
  });
  const [job] = await jobsOf(db, request.id);
  const claim = (await execution.claim(team.channel.id, job.id, lease))!;
  const operationId = claim.job.operationId!;
  // The run's own Topic, where it draws its cards; the job and its operation share it.
  const [topic] = await db
    .insert(topics)
    .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
    .returning();
  await db.update(channelJobs).set({ topicId: topic.id }).where(eq(channelJobs.id, job.id));
  await db
    .update(agentOperations)
    .set({ status: 'running', topicId: topic.id })
    .where(eq(agentOperations.id, operationId));
  const service = new ChannelPostService(db, fixture.ownerId, operationId, fixture.workspaceId);
  return { ...team, operationId, reporter, service, thread, topicId: topic.id };
};

/** A step of the run that drew `card`, as the agent runtime writes it. */
const drawCard = async (operationId: string, topicId: string) => {
  const messages = new MessageModel(db, fixture.ownerId, fixture.workspaceId);
  const step = await messages.create({
    content: '',
    metadata: { operationId },
    role: 'assistant',
    topicId,
  });
  await messages.create({
    content: 'Card drawn',
    parentId: step.id,
    plugin: { apiName: 'renderUI', arguments: '{}', identifier: 'lobe-a2ui', type: 'builtin' },
    pluginState: { surface: card },
    role: 'tool',
    tool_call_id: 'call-card',
    topicId,
  });
};

/**
 * The result a landed postMessage leaves in the run's Topic, as the agent runtime stores it: what
 * a later post and the run's own answer read to know which cards already went out.
 */
const recordPost = async (
  operationId: string,
  topicId: string,
  state: Awaited<ReturnType<ChannelPostService['postMessage']>>,
  callId: string,
) => {
  const messages = new MessageModel(db, fixture.ownerId, fixture.workspaceId);
  const step = await messages.create({
    content: '',
    metadata: { operationId },
    role: 'assistant',
    topicId,
  });
  await messages.create({
    content: JSON.stringify(state),
    parentId: step.id,
    plugin: {
      apiName: 'postMessage',
      arguments: '{}',
      identifier: 'lobe-channel',
      type: 'builtin',
    },
    pluginState: state as unknown as Record<string, unknown>,
    role: 'tool',
    tool_call_id: callId,
    topicId,
  });
};

const mainTimeline = (channelId: string) =>
  db
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), isNull(channelMessages.threadId)))
    .orderBy(channelMessages.sequence);

describe('ChannelPostService.postMessage', () => {
  it('posts a Thread run’s card to the main timeline as the Agent, once per tool call', async () => {
    const { channel, operationId, reporter, service, topicId } = await setup();
    await drawCard(operationId, topicId);

    const posted = await service.postMessage({ content: 'This week:' }, 'call-1');
    expect(posted).toMatchObject({
      cards: 1,
      channelId: channel.id,
      channelTitle: 'Team',
      threadId: null,
    });
    // A retried call returns the post it already made.
    expect((await service.postMessage({ content: 'This week:' }, 'call-1')).messageId).toBe(
      posted.messageId,
    );

    const timeline = await mainTimeline(channel.id);
    expect(timeline.filter((message) => message.agentId === reporter.agentId)).toEqual([
      expect.objectContaining({
        content: 'This week:\n\n[Card] Weekly report · 12 done',
        id: posted.messageId,
        metadata: expect.objectContaining({
          operationId,
          source: 'agent-post',
          surfaces: [card],
          surfacesBodyLength: 'This week:'.length,
        }),
        replyToId: null,
        routingStatus: 'reply',
        userId: null,
      }),
    ]);
    // It answers no request and wakes no one.
    expect(
      await db.select().from(channelJobs).where(eq(channelJobs.messageId, posted.messageId)),
    ).toEqual([]);
  });

  it('posts a card-only message, or text without the cards when asked', async () => {
    const { operationId, service, topicId } = await setup();
    await drawCard(operationId, topicId);

    const cardOnly = await service.postMessage({}, 'call-card-only');
    expect(cardOnly.cards).toBe(1);
    const textOnly = await service.postMessage(
      { content: 'Details follow.', includeCards: false },
      'call-text',
    );
    expect(textOnly.cards).toBe(0);
    const [stored] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, textOnly.messageId));
    expect(stored.content).toBe('Details follow.');
    expect(stored.metadata).not.toHaveProperty('surfaces');
  });

  it('posts into another Channel where the Agent is a member', async () => {
    const { asOwner, reporter, service } = await setup();
    const { channel: other } = await asOwner.create({ title: 'Announcements' });
    await asOwner.addAgent(other.id, {
      agentId: reporter.agentId!,
      config: {},
      name: 'Reporter',
    });

    const elsewhere = await service.postMessage(
      { channelId: other.id, content: 'Shipped.' },
      'call-elsewhere',
    );
    expect(elsewhere).toMatchObject({ channelId: other.id, channelTitle: 'Announcements' });
  });

  it('refuses where it is answering, an empty post, and a Channel the Agent cannot speak in', async () => {
    const { asOwner, channel, reporter, service, thread } = await setup();

    await expect(
      service.postMessage({ content: 'Hi', threadId: thread.id }, 'call-same'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(service.postMessage({ content: '  ' }, 'call-empty')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // Not a member of that Channel.
    const { channel: other } = await asOwner.create({ title: 'Elsewhere' });
    await expect(
      service.postMessage({ channelId: other.id, content: 'Hi' }, 'call-stranger'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Muted where it would post.
    await asOwner.setMemberMuted(channel.id, reporter.id, true);
    await expect(service.postMessage({ content: 'Hi' }, 'call-muted')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await asOwner.setMemberMuted(channel.id, reporter.id, false);

    // An archived Channel takes no posts.
    await asOwner.addAgent(other.id, { agentId: reporter.agentId!, config: {}, name: 'Reporter' });
    await asOwner.archive(other.id);
    await expect(
      service.postMessage({ channelId: other.id, content: 'Hi' }, 'call-archived'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(
      (await mainTimeline(channel.id)).filter((message) => message.agentId === reporter.agentId),
    ).toEqual([]);
  });

  it('posts a card once: not again by a later post or with the answer, unless named', async () => {
    const { operationId, service, topicId } = await setup();
    await drawCard(operationId, topicId);

    const first = await service.postMessage({ content: 'This week:' }, 'call-first');
    expect(first).toMatchObject({ cards: 1, surfaceIds: ['weekly'] });
    await recordPost(operationId, topicId, first, 'call-first');

    // A later post carries no card already posted; with nothing else to say it is refused.
    await expect(service.postMessage({}, 'call-again')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await service.postMessage({ content: 'More soon.' }, 'call-text')).toMatchObject({
      cards: 0,
      surfaceIds: [],
    });
    // The run's own answer leaves it out too.
    const messages = new MessageModel(db, fixture.ownerId, fixture.workspaceId);
    expect(await unpostedRunSurfaces(messages, operationId, topicId)).toEqual([]);

    // Named explicitly, it goes out again (its latest drawing).
    expect(await service.postMessage({ surfaceIds: ['weekly'] }, 'call-named')).toMatchObject({
      cards: 1,
      surfaceIds: ['weekly'],
    });
    await expect(
      service.postMessage({ surfaceIds: ['missing'] }, 'call-missing'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses an archived Thread instead of falling back to the main timeline', async () => {
    const { asOwner, channel, reporter, service } = await setup();
    const root = await asOwner.send(channel.id, {
      content: 'Old topic',
      requestKey: 'old-root',
      routing: 'fallback',
    });
    const old = await asOwner.createThread(channel.id, { rootMessageId: root.id });
    await asOwner.archiveThread(channel.id, old.id);

    await expect(
      service.postMessage({ content: 'Hi', threadId: old.id }, 'call-archived-thread'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.postMessage({ content: 'Hi', threadId: 'cht_missing' }, 'call-missing-thread'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await mainTimeline(channel.id)).filter((message) => message.agentId === reporter.agentId),
    ).toEqual([]);
  });
});

/**
 * The owner's Agent, shared by link, answers a group member the owner admitted. The run executes
 * as the owner, so it reaches the owner's Channels: only those it is itself in, saying whom it
 * posted for.
 */
describe('ChannelPostService.postMessage for a shared Agent’s visitor', () => {
  const agentId = 'agt_channel_post_shared';
  const asOwner = () => new ChannelRepository(db, fixture.ownerId);

  const setup = async () => {
    await db.insert(agents).values({ id: agentId, title: 'Star', userId: fixture.ownerId });
    await db.insert(agentShares).values({ agentId, shareConfig: {}, visibility: 'link' });
    const owner = asOwner();
    // Where the visitor (the fixture's member, "mia") asks the owner's Agent.
    const { channel: group, member: ownerMember } = await owner.create({ title: 'Owner & Mia' });
    const mia = await fixture.addPerson(group.id, fixture.memberId, 'member');
    const star = await owner.addAgent(group.id, { agentId, config: {}, name: 'Star' });
    await db.insert(channelAgentGrants).values({
      channelId: group.id,
      decidedAt: new Date(),
      granteeMemberId: mia.id,
      memberId: star.id,
      ownerId: fixture.ownerId,
      requestedByMemberId: mia.id,
      status: 'approved',
    });
    const request = await new ChannelRepository(db, fixture.memberId).send(group.id, {
      content: '@Star say hi to the owner privately',
      mentions: [star.id],
      requestKey: 'visitor-request',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(group.id, job.id, lease))!;
    expect(claim.job.executionConfig?.share).toMatchObject({ ownerId: fixture.ownerId });
    const operationId = claim.job.operationId!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, operationId));

    // The owner's own conversation with Star, which mia is not in.
    const { channel: dm } = await owner.create({ title: 'Owner · Star' });
    await owner.addAgent(dm.id, { agentId, config: {}, name: 'Star' });
    expect(ownerMember.userId).toBe(fixture.ownerId);
    return {
      dm,
      group,
      operationId,
      service: new ChannelPostService(db, fixture.ownerId, operationId),
    };
  };

  const stored = async (messageId: string) =>
    (await db.select().from(channelMessages).where(eq(channelMessages.id, messageId)))[0];

  it('posts where the Agent is with its owner, naming the visitor', async () => {
    const { dm, service } = await setup();

    const posted = await service.postMessage({ channelId: dm.id, content: 'Mia says hi.' }, 'c1');
    expect((await stored(posted.messageId)).metadata).toMatchObject({
      postedFor: { name: 'mia', userId: fixture.memberId },
      source: 'agent-post',
    });
    expect((await stored(posted.messageId)).metadata).not.toHaveProperty('postedFor.source');
  });

  it('links back when the visitor asked in a public Channel', async () => {
    const { dm, group, service } = await setup();
    // Only a workspace group can be made public; the post reads just its visibility.
    await db.update(channels).set({ visibility: 'public' }).where(eq(channels.id, group.id));

    const posted = await service.postMessage({ channelId: dm.id, content: 'Hi again.' }, 'c2');
    expect((await stored(posted.messageId)).metadata).toMatchObject({
      postedFor: {
        name: 'mia',
        source: {
          channelId: group.id,
          title: 'Owner & Mia',
          url: expect.stringContaining(`/channels/${group.id}`),
        },
        userId: fixture.memberId,
      },
    });
  });

  it('refuses the owner’s Channels the Agent is not in', async () => {
    const { service } = await setup();
    const { channel: elsewhere } = await asOwner().create({ title: 'Owner only' });

    await expect(
      service.postMessage({ channelId: elsewhere.id, content: 'Hi' }, 'c3'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
