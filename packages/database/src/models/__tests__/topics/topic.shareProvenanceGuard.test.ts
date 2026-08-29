import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

/**
 * `guardShareProvenance` walls the generic topic surface off from Agent Share
 * conversations — see `TopicModelOptions.guardShareProvenance`. `visitorId`
 * owns the share conversation rows; `creatorId` owns the agent.
 */
const visitorId = 'topic-share-guard-visitor';
const creatorId = 'topic-share-guard-creator';
const agentId = 'topic-share-guard-agent';
const shareId = '00000000-0000-4000-8000-000000000002';

const guardedModel = new TopicModel(serverDB, visitorId, undefined, {
  guardShareProvenance: true,
});
const internalModel = new TopicModel(serverDB, visitorId);

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, visitorId));
    await trx.delete(users).where(eq(users.id, creatorId));
    await trx.insert(users).values([{ id: visitorId }, { id: creatorId }]);
    await trx.insert(agents).values({ id: agentId, title: 'Shared', userId: creatorId });
    await trx.insert(topics).values([
      { agentId, id: 'guarded-share-topic', shareId, title: 'Share', userId: visitorId },
      { id: 'guarded-plain-topic', title: 'Plain', userId: visitorId },
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, visitorId));
  await serverDB.delete(users).where(eq(users.id, creatorId));
});

describe('TopicModel guardShareProvenance', () => {
  it('refuses to delete a share topic, keeping the visitor quota consumed', async () => {
    await expect(guardedModel.delete('guarded-share-topic')).rejects.toThrow(
      /belongs to an agent share/,
    );

    const rows = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(rows).toHaveLength(1);
  });

  it('still deletes ordinary topics', async () => {
    await guardedModel.delete('guarded-plain-topic');

    const rows = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-plain-topic'));
    expect(rows).toHaveLength(0);
  });

  it('excludes share topics from deleteAll instead of failing the sweep', async () => {
    await guardedModel.deleteAll();

    const rows = await serverDB.select().from(topics);
    expect(rows.map((row) => row.id)).toEqual(['guarded-share-topic']);
  });

  it('excludes share topics from batchDelete', async () => {
    await guardedModel.batchDelete(['guarded-share-topic', 'guarded-plain-topic']);

    const rows = await serverDB.select().from(topics);
    expect(rows.map((row) => row.id)).toEqual(['guarded-share-topic']);
  });

  it('excludes share topics from batchDeleteByAgentId', async () => {
    await guardedModel.batchDeleteByAgentId(agentId);

    const rows = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(rows).toHaveLength(1);
  });

  it('leaves internal (unguarded) writers untouched — shareChat cleanup still works', async () => {
    await internalModel.delete('guarded-share-topic');

    const rows = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(rows).toHaveLength(0);
  });
});
