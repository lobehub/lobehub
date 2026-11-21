// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { FtsSearchRepo } from '../../../repositories/ftsSearch';
import { PgLikeFtsSearchBackend } from '../../../repositories/ftsSearch/pgLike';
import { agents, messages, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { TopicModel } from '../../topic';

const requesterId = 'topic-channel-visibility-requester';
const teammateId = 'topic-channel-visibility-teammate';
const workspaceId = 'topic-channel-visibility-workspace';
const agentId = 'topic-channel-visibility-agent';
const serverDB: LobeChatDatabase = await getTestDB();

/** Hands every seeded row back as a candidate so only SQL hydration filters apply. */
const allCandidates = (topicIds: string[], messageIds: string[]) => ({
  ftsSearchCandidateEnabled: true,
  ftsSearchCandidates: vi.fn(async ({ entity }: { entity: string }) => {
    const ids = entity === 'topics' ? topicIds : messageIds;
    return { candidates: ids.map((id) => ({ id, score: 1 })), total: ids.length };
  }),
});

/**
 * A Channel run topic holds the requester's Channel request and whatever Channel
 * history the Agent read, so it must stay out of every listing outside the
 * Channel — for the requester as well as for workspace teammates.
 */
describe('TopicModel - Channel run topics', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: requesterId }, { id: teammateId }]);
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'Channel Visibility Workspace',
        primaryOwnerId: requesterId,
        slug: workspaceId,
      });
      await tx
        .insert(agents)
        .values({ id: agentId, userId: requesterId, visibility: 'public', workspaceId });
      await tx.insert(topics).values([
        {
          agentId,
          id: 'regular-topic',
          status: 'unread',
          title: 'Launch checklist',
          userId: requesterId,
          workspaceId,
        },
        {
          agentId,
          id: 'channel-topic',
          status: 'unread',
          title: 'Launch checklist from the Channel',
          trigger: 'channel',
          userId: requesterId,
          workspaceId,
        },
      ]);
      await tx.insert(messages).values([
        {
          agentId,
          content: 'launch checklist draft',
          id: 'regular-message',
          role: 'user',
          topicId: 'regular-topic',
          userId: requesterId,
          workspaceId,
        },
        {
          agentId,
          content: 'launch checklist with private Channel notes',
          id: 'channel-message',
          role: 'assistant',
          topicId: 'channel-topic',
          userId: requesterId,
          workspaceId,
        },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  const ids = (rows: { id: string }[]) => rows.map(({ id }) => id).sort();

  it('keeps Channel runs out of agent topic lists, even when the trigger is requested', async () => {
    const model = new TopicModel(serverDB, requesterId, workspaceId);

    const byAgent = await model.query({ agentId });
    expect(ids(byAgent.items)).toEqual(['regular-topic']);
    expect(byAgent.total).toBe(1);

    expect((await model.query({ agentId, triggers: ['channel'] })).items).toEqual([]);
    expect((await model.query({ agentId, includeTriggers: ['channel'] })).items).toEqual([]);
    expect(ids((await model.query({})).items)).toEqual(['regular-topic']);
  });

  it('keeps Channel runs out of the Inbox and team feed for every member', async () => {
    for (const userId of [requesterId, teammateId]) {
      const model = new TopicModel(serverDB, userId, workspaceId);
      const feed = await model.queryTopics({ statuses: ['running', 'unread'] });
      expect(ids(feed)).toEqual(['regular-topic']);
    }
  });

  it('keeps Channel runs out of topic stats, rank and recent topics', async () => {
    const model = new TopicModel(serverDB, requesterId, workspaceId);

    expect(await model.count({ agentId })).toBe(1);
    expect(ids(await model.rank())).toEqual(['regular-topic']);
    expect(ids(await model.queryRecent())).toEqual(['regular-topic']);
  });

  it('never feeds Channel runs into memory extraction', async () => {
    const model = new TopicModel(serverDB, requesterId, workspaceId);

    expect(ids(await model.listTopicsForMemoryExtractor())).toEqual(['regular-topic']);
    expect(await model.countTopicsForMemoryExtractor()).toBe(1);
  });

  it('keeps Channel runs out of topic keyword search', async () => {
    const model = new TopicModel(
      serverDB,
      requesterId,
      workspaceId,
      allCandidates(['regular-topic', 'channel-topic'], ['regular-message', 'channel-message']),
    );

    expect(ids(await model.queryByKeyword('launch'))).toEqual(['regular-topic']);
  });

  it('keeps Channel run messages out of message keyword search', async () => {
    const model = new MessageModel(
      serverDB,
      requesterId,
      workspaceId,
      allCandidates([], ['regular-message', 'channel-message']),
    );

    const result = await model.searchByKeyword({ keyword: 'launch' });
    expect(result.items.map(({ id }) => id)).toEqual(['regular-message']);
  });

  it('keeps Channel runs out of the command menu search', async () => {
    const repo = new FtsSearchRepo(serverDB, requesterId, workspaceId, undefined, {
      backend: new PgLikeFtsSearchBackend(serverDB, { userId: requesterId, workspaceId }),
    });

    const topicResults = await repo.search({ query: 'launch', type: 'topic' });
    expect(topicResults.map(({ id }) => id)).toEqual(['regular-topic']);

    const messageResults = await repo.search({ query: 'launch', type: 'message' });
    expect(messageResults.map(({ id }) => id)).toEqual(['regular-message']);
  });
});
