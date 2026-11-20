// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, agentShares, topics, users } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import {
  findShareVisitorTopic,
  listShareVisitorConversations,
  listShareVisitorTopics,
  readShareVisitorChannel,
} from '../shareVisitors';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-share-visitors');
const execution = new ChannelExecutionRepository(db);

// The fixture's member is the visitor; its owner shares an Agent.
const visitorId = fixture.memberId;
const ownerId = fixture.ownerId;
const agentId = 'agt_channel_share_visitors';
const visitor = new ChannelRepository(db, visitorId);

let shareId: string;

const setCreatorView = (allowCreatorViewSessions: boolean) =>
  db
    .update(agentShares)
    .set({ shareConfig: { allowCreatorViewSessions, slug: 'visitor-helper' } })
    .where(eq(agentShares.id, shareId));

/** A visitor's direct conversation with one claimed run, whose topic cost `cost`. */
const openConversation = async (cost: number, tokens: number) => {
  const { channel } = await visitor.create({ agentId, sharedAgent: true, title: 'Helper' });
  const message = await visitor.send(channel.id, {
    content: 'Hello helper',
    requestKey: 'first',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, message.id);
  const claim = (await execution.claim(channel.id, job.id, lease))!;
  await db
    .update(topics)
    .set({ totalCost: cost, totalTokens: tokens })
    .where(eq(topics.id, claim.topic.id));
  return { channel, topicId: claim.topic.id };
};

beforeEach(async () => {
  await fixture.setup();
  await db.update(users).set({ fullName: 'Visitor Vee' }).where(eq(users.id, visitorId));
  await db.insert(agents).values({
    id: agentId,
    model: 'owner-model',
    provider: 'owner-provider',
    title: 'Helper',
    userId: ownerId,
  });
  const [share] = await db
    .insert(agentShares)
    .values({ agentId, shareConfig: { slug: 'visitor-helper' }, visibility: 'link' })
    .returning();
  shareId = share.id;
});

afterEach(async () => {
  await fixture.cleanup();
});

describe('share visitor conversations', () => {
  it('stay hidden from the creator until the share lets them read them', async () => {
    const { channel } = await openConversation(0.5, 1200);

    expect(await listShareVisitorConversations(db, ownerId, agentId)).toEqual([]);
    expect(await readShareVisitorChannel(db, ownerId, channel.id)).toBeUndefined();
  });

  it('list one entry per visitor with the cost and tokens of its runs', async () => {
    await setCreatorView(true);
    const { channel } = await openConversation(0.25, 1500);

    const [listed, ...rest] = await listShareVisitorConversations(db, ownerId, agentId);
    expect(rest).toEqual([]);
    expect(listed).toMatchObject({
      id: channel.id,
      lastMessage: expect.objectContaining({ content: 'Hello helper' }),
      totalCost: 0.25,
      totalTokens: 1500,
      visitor: { id: visitorId, name: 'Visitor Vee' },
    });
  });

  it('are listed and read only by the Agent owner', async () => {
    await setCreatorView(true);
    const { channel } = await openConversation(0.25, 1500);

    expect(await listShareVisitorConversations(db, visitorId, agentId)).toEqual([]);
    expect(await readShareVisitorChannel(db, visitorId, channel.id)).toBeUndefined();
  });

  it('open read-only for the creator, without links to the private run topics', async () => {
    await setCreatorView(true);
    const { channel } = await openConversation(0.25, 1500);

    const view = (await readShareVisitorChannel(db, ownerId, channel.id))!;
    expect(view).toMatchObject({
      channel: { canDelete: false, id: channel.id, title: 'Visitor Vee' },
      joined: false,
      readOnly: true,
    });
    expect(view.messages.map((message) => message.content)).toContain('Hello helper');
    expect(view.messages.every((message) => message.sourceTopicId === null)).toBe(true);
    expect(view.jobs.length).toBeGreaterThan(0);
    expect(view.jobs.every((job) => !('topicId' in job))).toBe(true);
  });

  it('keep a Workspace member’s own conversation private, even after the Agent turns private', async () => {
    await setCreatorView(true);
    await db
      .update(agents)
      .set({ visibility: 'public', workspaceId: fixture.workspaceId })
      .where(eq(agents.id, agentId));
    const member = new ChannelRepository(db, visitorId, fixture.workspaceId);
    const { channel } = await member.create({ agentId, title: 'Helper' });
    const message = await member.send(channel.id, {
      content: 'Workspace question',
      requestKey: 'member',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const claim = (await execution.claim(channel.id, job.id, lease))!;
    expect(claim.job.executionConfig?.share).toBeUndefined();

    // Making the Agent private does not turn the member's earlier conversation into a share visit.
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agentId));
    expect(await listShareVisitorConversations(db, ownerId, agentId)).toEqual([]);
    expect(await readShareVisitorChannel(db, ownerId, channel.id)).toBeUndefined();
  });
});

describe('share visitor topics', () => {
  it('stay hidden from the creator until the share lets them read them', async () => {
    const { topicId } = await openConversation(0.5, 1200);

    expect(await listShareVisitorTopics(db, ownerId, agentId)).toEqual([]);
    expect(await findShareVisitorTopic(db, ownerId, topicId)).toBeUndefined();
  });

  it('list each visitor with the run topics of their conversation', async () => {
    await setCreatorView(true);
    const { topicId } = await openConversation(0.25, 1500);

    expect(await listShareVisitorTopics(db, ownerId, agentId)).toEqual([
      {
        topics: [
          expect.objectContaining({
            id: topicId,
            preview: 'Hello helper',
            totalCost: 0.25,
            totalTokens: 1500,
          }),
        ],
        visitor: expect.objectContaining({ id: visitorId, name: 'Visitor Vee' }),
      },
    ]);
    expect(await findShareVisitorTopic(db, ownerId, topicId)).toMatchObject({
      agentId,
      id: topicId,
      visitor: { id: visitorId, name: 'Visitor Vee' },
    });
  });

  it('are listed and opened only by the Agent owner', async () => {
    await setCreatorView(true);
    const { topicId } = await openConversation(0.25, 1500);

    expect(await listShareVisitorTopics(db, visitorId, agentId)).toEqual([]);
    expect(await findShareVisitorTopic(db, visitorId, topicId)).toBeUndefined();
  });

  it('drop a topic once it is trashed', async () => {
    await setCreatorView(true);
    const { topicId } = await openConversation(0.25, 1500);
    await db
      .update(topics)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(topics.id, topicId));

    expect(await listShareVisitorTopics(db, ownerId, agentId)).toEqual([]);
    expect(await findShareVisitorTopic(db, ownerId, topicId)).toBeUndefined();
  });

  it('keep a Workspace member’s own run topics private', async () => {
    await setCreatorView(true);
    await db
      .update(agents)
      .set({ visibility: 'public', workspaceId: fixture.workspaceId })
      .where(eq(agents.id, agentId));
    const member = new ChannelRepository(db, visitorId, fixture.workspaceId);
    const { channel } = await member.create({ agentId, title: 'Helper' });
    const message = await member.send(channel.id, {
      content: 'Workspace question',
      requestKey: 'member',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const claim = (await execution.claim(channel.id, job.id, lease))!;

    expect(await listShareVisitorTopics(db, ownerId, agentId)).toEqual([]);
    expect(await findShareVisitorTopic(db, ownerId, claim.topic.id)).toBeUndefined();
  });
});
