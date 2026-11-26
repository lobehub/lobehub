// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, agentShares, userContacts, works, workVersions } from '../../../schemas';
import type { Transaction } from '../../../type';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { readChannelView } from '../view';
import { tableContacts } from './tableContacts';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-works-shared', tableContacts);
const execution = new ChannelExecutionRepository(db);

// The fixture's member is the visitor; its owner shares an Agent.
const visitorId = fixture.memberId;
const ownerId = fixture.ownerId;
const agentId = 'agt_channel_reply_works_shared';
const visitor = new ChannelRepository(db, visitorId, undefined, tableContacts);

let shareId: string;

beforeEach(async () => {
  await fixture.setup();
  await db.insert(agents).values({ id: agentId, title: 'Shared Helper', userId: ownerId });
  const [share] = await db
    .insert(agentShares)
    .values({ agentId, shareConfig: { monthlySpendLimit: 1 }, visibility: 'link' })
    .returning();
  shareId = share.id;
});

afterEach(async () => {
  await db.delete(userContacts);
  await fixture.cleanup();
});

/** The visitor asks the shared Agent, whose run (as the owner) publishes a reply. */
const sharedReply = async () => {
  const { channel } = await visitor.create({ agentId, sharedAgent: true, title: 'Shared Helper' });
  const message = await visitor.send(channel.id, {
    content: 'Collect the images',
    requestKey: 'collect',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, message.id);
  const claim = (await execution.claim(channel.id, job.id, lease))!;
  await execution.accepted(channel.id, job.id);
  await execution.saveDraft(channel.id, job.id, 'Collected them');
  await execution.publish(channel.id, job.id);
  await execution.releaseWriter(channel.id, job.id);
  const replyOf = (view: Awaited<ReturnType<typeof visitor.detail>>) =>
    view.messages.find((entry) => entry.routingStatus === 'reply')!;
  return {
    channelId: channel.id,
    operationId: claim.job.operationId!,
    replyOf,
    topicId: claim.topic.id,
  };
};

/** A Work the share run registered: owned by the Agent's owner, stamped with the visitor scope. */
const addShareWork = async (params: {
  operationId: string;
  topicId: string;
  type: 'collection' | 'document' | 'external';
  visitorUserId?: string;
}) => {
  const collection = params.type === 'collection';
  const [work] = await db
    .insert(works)
    .values({
      metadata: {
        agentEditable: true,
        agentShare: {
          shareId,
          topicId: params.topicId,
          visitorUserId: params.visitorUserId ?? visitorId,
        },
      } as typeof works.$inferInsert.metadata,
      resourceId: `${params.type}:${Math.random()}`,
      resourceType: (
        { collection: 'collection', document: 'document', external: 'github_pull_request' } as const
      )[params.type],
      title: collection ? 'Sketches' : 'Show works in channels',
      toolIdentifier: 'lobe-work',
      toolName: 'createWork',
      type: params.type,
      url: collection ? '/f/file_cover' : 'https://github.com/lobehub/lobehub/pull/1',
      userId: ownerId,
      visibility: 'private',
    })
    .returning();
  const [version] = await db
    .insert(workVersions)
    .values({
      changeType: 'created',
      cumulativeCost: 0.3,
      metadata: collection
        ? { collection: { items: [{ fileId: 'file_cover', url: '/f/file_cover' }] } }
        : null,
      rootOperationId: params.operationId,
      toolIdentifier: 'lobe-work',
      toolName: 'createWork',
      version: 1,
      workId: work.id,
    })
    .returning();
  await db.update(works).set({ currentVersionId: version.id }).where(eq(works.id, work.id));
  return work;
};

describe('Channel reply works of a shared Agent', () => {
  it('shows the visitor the Works their run registered as the owner, without the owner', async () => {
    const state = await sharedReply();
    const collection = await addShareWork({ ...state, type: 'collection' });
    await addShareWork({ ...state, type: 'external' });
    // A document only opens through the owner's Work, so the reply draws no dead card for it.
    await addShareWork({ ...state, type: 'document' });

    const cards = state.replyOf(
      await visitor.detail(state.channelId, { includeFileWorks: true }),
    ).works!;

    expect(cards.map((card) => card.type).sort()).toEqual(['collection', 'external']);
    expect(cards.find((card) => card.type === 'collection')).toMatchObject({
      event: {
        cumulativeCost: null,
        metadata: { collection: { items: [{ fileId: 'file_cover' }] } },
      },
      id: collection.id,
      title: 'Sketches',
      totalCost: null,
    });
    const payload = JSON.stringify(cards);
    expect(payload).not.toContain(ownerId);
    expect(payload).not.toContain('"userId"');
  });

  it('keeps opt-in types from clients that did not ask for them', async () => {
    const state = await sharedReply();
    await addShareWork({ ...state, type: 'collection' });
    await addShareWork({ ...state, type: 'external' });

    const cards = state.replyOf(await visitor.detail(state.channelId)).works!;
    expect(cards.map((card) => card.type)).toEqual(['external']);
  });

  it('keeps Works of another visitor scope out', async () => {
    const state = await sharedReply();
    await addShareWork({ ...state, type: 'collection', visitorUserId: ownerId });

    const reply = state.replyOf(await visitor.detail(state.channelId, { includeFileWorks: true }));
    expect(reply.works).toEqual([]);
  });

  it('shows anyone else reading the conversation only the external Works, without their ids', async () => {
    const state = await sharedReply();
    await addShareWork({ ...state, type: 'collection' });
    const external = await addShareWork({ ...state, type: 'external' });

    const view = await readChannelView(
      db as unknown as Transaction,
      state.channelId,
      { includeFileWorks: true },
      ownerId,
    );
    const cards = view.messages.find((entry) => entry.routingStatus === 'reply')!.works;
    expect(cards).toEqual([
      expect.objectContaining({ id: 'https://github.com/lobehub/lobehub/pull/1', userId: '' }),
    ]);
    expect(JSON.stringify(cards)).not.toContain(external.id);
  });
});
