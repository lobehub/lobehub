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

  it('excludes share topics from batchMoveToAgent — the quota-refund-by-move path', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'guarded-visitor-agent', title: 'Mine', userId: visitorId });

    await guardedModel.batchMoveToAgent(
      ['guarded-share-topic', 'guarded-plain-topic'],
      'guarded-visitor-agent',
    );

    const rows = await serverDB.select().from(topics).orderBy(topics.id);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.agentId]));
    expect(byId['guarded-share-topic']).toBe(agentId);
    expect(byId['guarded-plain-topic']).toBe('guarded-visitor-agent');
  });

  it('refuses to settle a running operation on a share topic', async () => {
    await serverDB
      .update(topics)
      .set({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-1', operationId: 'op-1' },
        },
        status: 'running',
      })
      .where(eq(topics.id, 'guarded-share-topic'));

    await expect(
      guardedModel.settleRunningOperation('guarded-share-topic', 'op-1'),
    ).rejects.toThrow(/belongs to an agent share/);

    const [row] = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(row.metadata?.runningOperation).toMatchObject({ operationId: 'op-1' });
  });

  it('refuses generic updates on a share topic — the historySummary injection path', async () => {
    await expect(
      guardedModel.update('guarded-share-topic', { historySummary: 'x'.repeat(10) }),
    ).rejects.toThrow(/belongs to an agent share/);

    const [row] = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(row.historySummary).toBeNull();
  });

  it('still updates ordinary topics, and internal writers update share topics', async () => {
    await guardedModel.update('guarded-plain-topic', { title: 'Renamed' });
    await internalModel.update('guarded-share-topic', { title: 'Internal rename' });

    const rows = await serverDB.select().from(topics).orderBy(topics.id);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.title]));
    expect(byId['guarded-plain-topic']).toBe('Renamed');
    expect(byId['guarded-share-topic']).toBe('Internal rename');
  });

  it('refuses generic metadata updates on a share topic — the runningOperation clear path', async () => {
    await expect(
      guardedModel.updateMetadata('guarded-share-topic', { runningOperation: null }),
    ).rejects.toThrow(/belongs to an agent share/);
  });

  it('still updates metadata on ordinary topics', async () => {
    await guardedModel.updateMetadata('guarded-plain-topic', { model: 'gpt-4o' });

    const [row] = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-plain-topic'));
    expect(row.metadata?.model).toBe('gpt-4o');
  });

  it('still settles ordinary topics, and internal writers settle share topics', async () => {
    await serverDB
      .update(topics)
      .set({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-1', operationId: 'op-1' },
        },
        status: 'running',
      })
      .where(eq(topics.id, 'guarded-share-topic'));

    const settled = await internalModel.settleRunningOperation('guarded-share-topic', 'op-1');
    expect(settled.status).toBe('settled');
  });

  it('leaves internal (unguarded) writers untouched — shareChat cleanup still works', async () => {
    await internalModel.delete('guarded-share-topic');

    const rows = await serverDB.select().from(topics).where(eq(topics.id, 'guarded-share-topic'));
    expect(rows).toHaveLength(0);
  });
});
