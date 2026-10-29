// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  chatGroups,
  documents,
  sessions,
  topicDocuments,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';
import { createTopicModelContext } from '../../topic/context';
import { createProxyTestDB } from '../_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-scope-guards-user';
const teammateId = 'topic-scope-guards-teammate';
const workspaceId = 'topic-scope-guards-workspace';
const agentId = 'topic-scope-guards-agent';
const sessionId = 'topic-scope-guards-session';
const groupId = 'topic-scope-guards-group';

const topicModel = new TopicModel(serverDB, userId);
const deletedAt = new Date('2026-10-01T00:00:00.000Z');

/** Every query comes back without rows — the shape an aggregate never returns on its own. */
const noRowsDB = () => createProxyTestDB(serverDB, () => []);

const liveTopicIds = async (ids: string[]) => {
  const rows = await serverDB
    .select({ deletedAt: topics.deletedAt, id: topics.id })
    .from(topics)
    .where(inArray(topics.id, ids));
  return rows
    .filter((row) => row.deletedAt === null)
    .map((row) => row.id)
    .sort();
};

beforeEach(async () => {
  await serverDB.transaction(async (tx) => {
    await tx.insert(users).values([{ id: userId }, { id: teammateId }]);
    await tx.insert(workspaces).values({
      id: workspaceId,
      name: 'Topic Scope Guards',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await tx.insert(agents).values({ id: agentId, userId });
    await tx.insert(sessions).values({ id: sessionId, userId });
    await tx.insert(chatGroups).values({ id: groupId, userId });
  });
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  // Topics, agents, sessions, groups and documents cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId, teammateId]));
});

describe('TopicModel lookup guards', () => {
  it('scopes a keyword search to a group before any agent or container', async () => {
    await serverDB.insert(topics).values([
      { agentId, groupId, id: 'kw-group', userId },
      { agentId, id: 'kw-agent', userId },
    ]);
    const ctx = createTopicModelContext({ db: serverDB, includeShareVisitor: false, userId });

    const rows = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(ctx.matchKeywordScope({ agentId, groupId }));

    expect(rows.map((row) => row.id)).toEqual(['kw-group']);
  });

  it('answers empty id lists and blank keywords without a query', async () => {
    await serverDB.insert(topics).values({ id: 'empty-guard', senderId: 'visitor-1', userId });

    expect(await topicModel.findShareVisitorTopicIds([])).toEqual([]);
    expect(await topicModel.findByIds([])).toEqual([]);
    expect(await topicModel.queryByKeyword('   ')).toEqual([]);
  });

  it('finds the topic an agent shares with a document for one trigger only', async () => {
    await serverDB.insert(documents).values({
      fileType: 'custom/document',
      id: 'doc-scope-guards',
      source: 'doc-scope-guards',
      sourceType: 'api',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    });
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'doc-topic', trigger: 'document-chat', userId });
    await serverDB
      .insert(topicDocuments)
      .values({ documentId: 'doc-scope-guards', topicId: 'doc-topic', userId });

    const params = { agentId, documentId: 'doc-scope-guards', trigger: 'document-chat' };

    expect((await topicModel.findByAgentAndDocumentTrigger(params))?.id).toBe('doc-topic');
    expect(
      await topicModel.findByAgentAndDocumentTrigger({ ...params, trigger: 'other' }),
    ).toBeUndefined();
    expect(
      await new TopicModel(serverDB, teammateId).findByAgentAndDocumentTrigger(params),
    ).toBeUndefined();
  });

  it('counts only the topics in the requested container', async () => {
    await serverDB.insert(topics).values([
      { id: 'count-session', sessionId, userId },
      { id: 'count-group', groupId, userId },
      { id: 'count-loose', userId },
    ]);

    expect(await topicModel.count({ containerId: sessionId })).toBe(1);
    expect(await topicModel.count({ containerId: groupId })).toBe(1);
  });

  it('skips a cron topic whose job id is not a usable string', async () => {
    await serverDB.insert(topics).values([
      {
        agentId,
        id: 'cron-valid',
        metadata: { cronJobId: 'job-1' } as never,
        trigger: 'cron',
        userId,
      },
      // `->> 'cronJobId'` renders the number as '0', so SQL keeps the row and
      // only the in-memory guard drops it.
      { agentId, id: 'cron-numeric', metadata: { cronJobId: 0 } as never, trigger: 'cron', userId },
    ]);

    const groups = await topicModel.getCronTopicsGroupedByCronJob(agentId);

    expect(groups).toHaveLength(1);
    expect(groups[0].cronJobId).toBe('job-1');
    expect(groups[0].topics.map((topic) => topic.id)).toEqual(['cron-valid']);
  });

  it('adopts legacy rows of the agent’s old session in the agent list', async () => {
    await serverDB.insert(topics).values([
      { agentId, id: 'list-agent', userId },
      { id: 'list-legacy', sessionId, userId },
      { id: 'list-unrelated', userId },
    ]);

    const result = await topicModel.query({ agentId, legacySessionId: sessionId });

    expect(result.items.map((topic) => topic.id).sort()).toEqual(['list-agent', 'list-legacy']);
  });
});

describe('TopicModel memory-extractor date windows', () => {
  beforeEach(async () => {
    await serverDB.insert(topics).values([
      { createdAt: new Date('2026-01-01'), id: 'mem-jan', userId },
      { createdAt: new Date('2026-02-01'), id: 'mem-feb', userId },
      { createdAt: new Date('2026-03-01'), id: 'mem-mar', userId },
    ]);
  });

  const window = { endDate: new Date('2026-02-15'), startDate: new Date('2026-01-15') };

  it('lists only topics created inside the window', async () => {
    const rows = await topicModel.listTopicsForMemoryExtractor(window);

    expect(rows.map((row) => row.id)).toEqual(['mem-feb']);
  });

  it('counts only topics created inside the window', async () => {
    expect(await topicModel.countTopicsForMemoryExtractor(window)).toBe(1);
  });

  it('counts zero when the driver returns no aggregate row', async () => {
    expect(await new TopicModel(noRowsDB(), userId).countTopicsForMemoryExtractor()).toBe(0);
  });
});

describe('TopicModel share-visitor roll-up', () => {
  it('reports zero visitors when the driver returns no aggregate row', async () => {
    const result = await new TopicModel(noRowsDB(), userId).countShareVisitors({ agentId });

    expect(result).toEqual({ topicCount: 0, visitorCount: 0 });
  });
});

describe('TopicModel trash scoping', () => {
  const memberModel = new TopicModel(serverDB, userId, workspaceId);
  const restrict = { deletedAt, restrictToCreator: true };

  it('trashes only the caller’s own workspace topics by id when restricted to creator', async () => {
    await serverDB.insert(topics).values([
      { id: 'ws-mine', userId, workspaceId },
      { id: 'ws-teammate', userId: teammateId, workspaceId },
    ]);

    const trashed = await memberModel.softDelete(['ws-mine', 'ws-teammate'], restrict);

    expect(trashed.map((topic) => topic.id)).toEqual(['ws-mine']);
    expect(await liveTopicIds(['ws-mine', 'ws-teammate'])).toEqual(['ws-teammate']);
  });

  it('trashes only the caller’s own topics of a session or group when restricted', async () => {
    await serverDB.insert(topics).values([
      { id: 'ws-session-mine', sessionId, userId, workspaceId },
      { id: 'ws-session-teammate', sessionId, userId: teammateId, workspaceId },
      { groupId, id: 'ws-group-mine', userId, workspaceId },
      { groupId, id: 'ws-group-teammate', userId: teammateId, workspaceId },
    ]);

    const bySession = await memberModel.softDeleteBySessionId(sessionId, restrict);
    const byGroup = await memberModel.softDeleteByGroupId(groupId, restrict);

    expect(bySession.map((topic) => topic.id)).toEqual(['ws-session-mine']);
    expect(byGroup.map((topic) => topic.id)).toEqual(['ws-group-mine']);
    expect(
      await liveTopicIds([
        'ws-session-mine',
        'ws-session-teammate',
        'ws-group-mine',
        'ws-group-teammate',
      ]),
    ).toEqual(['ws-group-teammate', 'ws-session-teammate']);
  });

  it('trashes an agent’s topics plus its legacy session rows across the workspace', async () => {
    await serverDB.insert(topics).values([
      { agentId, id: 'agent-teammate', userId: teammateId, workspaceId },
      { id: 'agent-legacy', sessionId, userId, workspaceId },
      { id: 'agent-unrelated', userId, workspaceId },
    ]);

    const trashed = await memberModel.softDeleteByAgentId(agentId, {
      deletedAt,
      legacySessionId: sessionId,
    });

    expect(trashed.map((topic) => topic.id).sort()).toEqual(['agent-legacy', 'agent-teammate']);
    expect(await liveTopicIds(['agent-unrelated'])).toEqual(['agent-unrelated']);
  });

  it('trashes only the caller’s own topics under an agent parent when restricted', async () => {
    await serverDB.insert(topics).values([
      { agentId, id: 'parent-mine', userId, workspaceId },
      { agentId, id: 'parent-teammate', userId: teammateId, workspaceId },
    ]);

    const trashed = await memberModel.softDeleteByParents({ agentIds: [agentId] }, restrict);

    expect(trashed.map((topic) => topic.id)).toEqual(['parent-mine']);
    expect(await liveTopicIds(['parent-mine', 'parent-teammate'])).toEqual(['parent-teammate']);
  });
});

describe('TopicModel model-pin guards', () => {
  it('returns nothing for a topic the caller cannot see', async () => {
    await serverDB.insert(topics).values({ id: 'pin-foreign', model: 'old', userId: teammateId });

    expect(
      await topicModel.updateModelPin('pin-foreign', { model: 'new', provider: 'openai' }),
    ).toEqual([]);
    const row = await serverDB.query.topics.findFirst({
      where: (t, { eq }) => eq(t.id, 'pin-foreign'),
    });
    expect(row?.model).toBe('old');
  });

  it('pins hetero effort and speed with the new model and drops the old reasoning pin', async () => {
    await serverDB.insert(topics).values({
      id: 'pin-hetero',
      metadata: { boundDeviceId: 'device-1', reasoningConfig: { effort: 'high' } as never },
      userId,
    });

    const [updated] = await topicModel.updateModelPin('pin-hetero', {
      metadata: { heteroEffort: 'low' as never, heteroSpeed: 'fast' },
      model: 'new-model',
      provider: 'openai',
    });

    expect(updated.model).toBe('new-model');
    expect(updated.metadata).toEqual({
      boundDeviceId: 'device-1',
      heteroEffort: 'low',
      heteroSpeed: 'fast',
    });
  });
});
