// @vitest-environment node
import type { UIChatMessage } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { toVisitorMessage } from '../../message/visitor';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'msg-cov-group-d-user';
const messageModel = new MessageModel(serverDB, userId);

const T0 = new Date('2026-07-20T00:00:00.000Z');
const T1 = new Date('2026-07-20T00:01:00.000Z');
const T2 = new Date('2026-07-20T00:02:00.000Z');

/**
 * A MessageModel whose transactions hand the callback a proxied `tx`, so a test
 * can rewrite one query's result to reach a defensive guard the real schema
 * never produces.
 */
const modelWithTx = (wrapTx: (tx: any) => any) => {
  const db = new Proxy(serverDB as any, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (cb: (tx: any) => Promise<unknown>, config?: unknown) =>
          target.transaction((tx: any) => cb(wrapTx(tx)), config);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return new MessageModel(db as LobeChatDatabase, userId);
};

const overrideTx = (tx: any, overrides: Record<string, unknown>) =>
  new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop as string];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/** Insert a tool message and a plugin row whose optional columns are all NULL. */
const seedBarePlugin = async (opts: {
  apiName?: string | null;
  createdAt: Date;
  id: string;
  metadata?: Record<string, unknown>;
  topicId?: string;
}) => {
  await serverDB.insert(messages).values({
    content: null,
    createdAt: opts.createdAt,
    id: opts.id,
    metadata: opts.metadata,
    role: 'tool',
    topicId: opts.topicId ?? 'topic-d',
    userId,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: opts.apiName ?? null,
    arguments: null,
    clientId: null,
    error: null,
    id: opts.id,
    identifier: null,
    intervention: null,
    state: null,
    toolCallId: null,
    type: null,
    userId,
  });
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: 'topic-d', userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('plugin reads normalise NULL plugin columns', () => {
  it('listMessagePluginsByTopic maps NULL columns to undefined and type to default', async () => {
    await seedBarePlugin({ createdAt: T1, id: 'bare-topic' });

    const rows = await messageModel.listMessagePluginsByTopic('topic-d');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'bare-topic', type: 'default', userId });
    expect(rows[0].apiName).toBeUndefined();
    expect(rows[0].arguments).toBeUndefined();
    expect(rows[0].identifier).toBeUndefined();
    expect(rows[0].toolCallId).toBeUndefined();
  });

  it('listToolCallsInTopics maps NULL arguments and content to undefined', async () => {
    await seedBarePlugin({ apiName: 'askUserQuestion', createdAt: T1, id: 'bare-call' });

    const rows = await messageModel.listToolCallsInTopics({
      apiName: 'askUserQuestion',
      topicIds: ['topic-d'],
    });

    expect(rows).toEqual([
      { arguments: undefined, content: undefined, createdAt: T1, topicId: 'topic-d' },
    ]);
  });

  it('listMessagePluginsForOperation dedupes a row found by both window and heterogeneous match', async () => {
    await seedBarePlugin({
      createdAt: T1,
      id: 'bare-op',
      metadata: { heterogeneousToolStateOperationId: 'op-d' },
    });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T2,
      operationId: 'op-d',
      startedAt: T0,
      topicId: 'topic-d',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'bare-op', type: 'default' });
    expect(rows[0].apiName).toBeUndefined();
    expect(rows[0].arguments).toBeUndefined();
    expect(rows[0].clientId).toBeUndefined();
    expect(rows[0].content).toBeUndefined();
    expect(rows[0].identifier).toBeUndefined();
    expect(rows[0].state).toBeUndefined();
    expect(rows[0].toolCallId).toBeUndefined();
  });

  it('listMessagePluginsForOperation breaks createdAt ties by id', async () => {
    await seedBarePlugin({ createdAt: T1, id: 'tie-b' });
    await seedBarePlugin({ createdAt: T1, id: 'tie-a' });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T2,
      operationId: 'op-none',
      startedAt: T0,
      topicId: 'topic-d',
    });

    expect(rows.map((row) => row.id)).toEqual(['tie-a', 'tie-b']);
  });

  it('listMessagePluginsByIds maps NULL columns to undefined and breaks ties by id', async () => {
    await seedBarePlugin({ createdAt: T1, id: 'bare-ids' });
    await seedBarePlugin({ createdAt: T1, id: 'bare-ids-0' });

    const rows = await messageModel.listMessagePluginsByIds({
      ids: ['bare-ids-0', 'bare-ids'],
      topicId: 'topic-d',
    });

    expect(rows.map((row) => row.id)).toEqual(['bare-ids', 'bare-ids-0']);
    expect(rows[0]).toMatchObject({ id: 'bare-ids', type: 'default' });
    expect(rows[0].apiName).toBeUndefined();
    expect(rows[0].arguments).toBeUndefined();
    expect(rows[0].content).toBeUndefined();
    expect(rows[0].identifier).toBeUndefined();
    expect(rows[0].toolCallId).toBeUndefined();
  });
});

describe('updateToolMessage guards', () => {
  it('reports failure when a metadata patch targets a missing message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await messageModel.updateToolMessage('missing-tool', {
      metadata: { foo: 'bar' },
    });

    expect(result).toEqual({ applied: false, success: false });
  });

  it('merges a metadata patch over a falsy (non-object) stored metadata value', async () => {
    await serverDB.insert(messages).values({
      content: '',
      id: 'falsy-meta',
      metadata: sql`'0'::jsonb` as any,
      role: 'tool',
      topicId: 'topic-d',
      userId,
    });

    const result = await messageModel.updateToolMessage('falsy-meta', {
      metadata: { foo: 'bar' },
    });

    expect(result).toEqual({ applied: true, snapshotSeq: undefined, success: true });
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'falsy-meta'));
    expect(row.metadata).toEqual({ foo: 'bar' });
  });

  it('stamps heterogeneous snapshot metadata when no metadata patch is given', async () => {
    await seedBarePlugin({ createdAt: T1, id: 'hetero-only' });

    const result = await messageModel.updateToolMessage('hetero-only', {
      heterogeneousToolState: { operationId: 'op-h', snapshotSeq: 3 } as any,
    });

    expect(result).toEqual({ applied: true, snapshotSeq: 3, success: true });
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'hetero-only'));
    expect(row.metadata).toEqual({
      heterogeneousToolStateOperationId: 'op-h',
      heterogeneousToolStateSeq: 3,
    });
  });

  it('fails a heterogeneous snapshot whose message has no plugin row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await serverDB
      .insert(messages)
      .values({ content: '', id: 'no-plugin', role: 'tool', topicId: 'topic-d', userId });

    const result = await messageModel.updateToolMessage('no-plugin', {
      heterogeneousToolState: { operationId: 'op-x', snapshotSeq: 1 } as any,
      pluginState: { ok: true },
    });

    expect(result).toEqual({ applied: false, success: false });
    // The throw rolls back the metadata stamp.
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'no-plugin'));
    expect(row.metadata).toBeNull();
  });
});

describe('toVisitorMessage model-info passthrough', () => {
  it('keeps pinnedMessages untouched when the share exposes model info', () => {
    const pinnedMessages = [{ content: 'p', id: 'pin-1', model: 'gpt-4o', role: 'assistant' }];

    const visitor = toVisitorMessage(
      { content: 'c', id: 'm', pinnedMessages, role: 'assistant' } as unknown as UIChatMessage,
      { showModelInfo: true },
    );

    expect(visitor.pinnedMessages).toBe(pinnedMessages);
  });

  it('projects a null council to an empty member list', () => {
    const visitor = toVisitorMessage({
      content: 'c',
      council: null,
      id: 'm',
      role: 'assistant',
    } as unknown as UIChatMessage);

    expect((visitor as unknown as { council: unknown[] }).council).toEqual([]);
  });
});

describe('createUserAndAssistantMessages timestamps and guards', () => {
  it('leaves updatedAt to the column default when createdAt is supplied', async () => {
    const result = await messageModel.createUserAndAssistantMessages({
      assistantMessage: {
        content: '',
        createdAt: T2.getTime(),
        role: 'assistant',
        topicId: 'topic-d',
      } as any,
      userMessage: {
        content: 'hi',
        createdAt: T1.getTime(),
        role: 'user',
        topicId: 'topic-d',
      } as any,
    });

    expect(result.userMessage.createdAt.getTime()).toBe(T1.getTime());
    expect(result.assistantMessage.createdAt.getTime()).toBe(T2.getTime());
    // Not stamped from createdAt: the DB default (now) applies instead.
    expect(result.userMessage.updatedAt.getTime()).not.toBe(T1.getTime());
    expect(result.assistantMessage.updatedAt.getTime()).not.toBe(T2.getTime());
  });

  it('throws and rolls back when the insert does not return both rows', async () => {
    const model = modelWithTx((tx) =>
      overrideTx(tx, {
        insert: (table: unknown) => {
          const builder = tx.insert(table);
          if (table !== messages) return builder;
          return {
            values: (values: unknown) => ({
              returning: async () => (await builder.values(values).returning()).slice(0, 1),
            }),
          };
        },
      }),
    );

    await expect(
      model.createUserAndAssistantMessages(
        {
          assistantMessage: { content: '', role: 'assistant', topicId: 'topic-d' } as any,
          userMessage: { content: 'hi', role: 'user', topicId: 'topic-d' } as any,
        },
        { ids: { assistantMessageId: 'pair-a', userMessageId: 'pair-u' } },
      ),
    ).rejects.toThrow('Failed to create user and assistant messages');

    const rows = await serverDB.select().from(messages).where(eq(messages.topicId, 'topic-d'));
    expect(rows).toHaveLength(0);
  });
});
