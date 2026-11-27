// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'hetero-ingest-reads-user';
const otherUserId = 'hetero-ingest-reads-other-user';
const topicId = 'hetero-ingest-topic';
const otherTopicId = 'hetero-ingest-topic-2';
const interventionStateKey = 'heterogeneousIntervention';

const messageModel = new MessageModel(serverDB, userId);

const OLD = new Date('2026-10-01T00:00:00Z');
const SINCE = new Date('2026-10-01T00:10:00Z');
const RECENT = new Date('2026-10-01T00:10:05Z');

const seedTool = async (args: {
  createdAt?: Date;
  id: string;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  state?: Record<string, unknown>;
  topicId?: string;
  updatedAt?: Date;
}) => {
  const owner = args.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: 'tool output',
    createdAt: args.createdAt ?? OLD,
    id: args.id,
    metadata: args.metadata,
    role: 'tool',
    topicId: args.topicId ?? topicId,
    updatedAt: args.updatedAt ?? args.createdAt ?? OLD,
    userId: owner,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: 'askUserQuestion',
    arguments: '{"questions":[]}',
    id: args.id,
    identifier: 'claude-code',
    state: args.state,
    toolCallId: `tc-${args.id}`,
    userId: owner,
  });
};

const since = (ids?: string[]) =>
  messageModel.listToolCallIndexByTopicSince(topicId, { ids, interventionStateKey, since: SINCE });

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: otherTopicId, userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.listToolCallIndexByTopicSince', () => {
  it('returns only rows created or updated at or after `since`', async () => {
    await seedTool({ id: 'tool-old' });
    await seedTool({ createdAt: RECENT, id: 'tool-new' });
    await seedTool({ id: 'tool-touched', updatedAt: RECENT });
    await seedTool({ createdAt: SINCE, id: 'tool-boundary' });

    const rows = await since();

    // First-seen order (createdAt, id), like the full index.
    expect(rows.map((row) => row.id)).toEqual(['tool-touched', 'tool-boundary', 'tool-new']);
  });

  it('picks up a tool-state sequence written through a messages UPDATE', async () => {
    await seedTool({ id: 'tool-seq' });
    expect(await since()).toEqual([]);

    // Real write path: `messages.updated_at` moves via `$onUpdate`.
    await serverDB
      .update(messages)
      .set({
        metadata: { heterogeneousToolStateOperationId: 'op-1', heterogeneousToolStateSeq: 7 },
      })
      .where(eq(messages.id, 'tool-seq'));

    const rows = await messageModel.listToolCallIndexByTopicSince(topicId, {
      interventionStateKey,
      since: new Date(Date.now() - 60_000),
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'tool-seq',
        metadata: { heterogeneousToolStateOperationId: 'op-1', heterogeneousToolStateSeq: 7 },
      }),
    ]);
  });

  it('re-reads named rows whatever their age, so plugin-only writes are seen', async () => {
    await seedTool({ id: 'tool-question' });
    await seedTool({ createdAt: RECENT, id: 'tool-new' });
    // A plugin-only write (intervention / state) never moves messages.updated_at.
    await serverDB
      .update(messagePlugins)
      .set({
        intervention: { status: 'approved' },
        state: { [interventionStateKey]: { operationId: 'op-1', transition: 'resolved' } },
      })
      .where(eq(messagePlugins.id, 'tool-question'));

    expect((await since()).map((row) => row.id)).toEqual(['tool-new']);

    const rows = await since(['tool-question', 'tool-new']);
    expect(rows).toEqual([
      {
        apiName: 'askUserQuestion',
        arguments: '{"questions":[]}',
        id: 'tool-question',
        identifier: 'claude-code',
        intervention: { status: 'approved' },
        metadata: {},
        state: { [interventionStateKey]: { operationId: 'op-1', transition: 'resolved' } },
        toolCallId: 'tc-tool-question',
      },
      // Returned once even though both predicates match.
      expect.objectContaining({ arguments: undefined, id: 'tool-new', state: undefined }),
    ]);
  });

  it('keeps the topic and ownership scope for both recent and named rows', async () => {
    await seedTool({ createdAt: RECENT, id: 'tool-in-scope' });
    await seedTool({ createdAt: RECENT, id: 'tool-other-topic', topicId: otherTopicId });
    await seedTool({ createdAt: RECENT, id: 'tool-other-user', ownerId: otherUserId });

    const rows = await since(['tool-other-topic', 'tool-other-user']);

    expect(rows.map((row) => row.id)).toEqual(['tool-in-scope']);
  });

  it('projects rows exactly like the full index', async () => {
    await seedTool({
      createdAt: RECENT,
      id: 'tool-a',
      metadata: { operationId: 'op-1', usage: { totalTokens: 9 } },
      state: { [interventionStateKey]: { transition: 'pending' }, todos: ['big'] },
    });
    await seedTool({ createdAt: RECENT, id: 'tool-b', state: { todos: ['big'] } });

    const full = await messageModel.listToolCallIndexByTopic(topicId, { interventionStateKey });

    expect(await since()).toEqual(full);
  });
});

describe('MessageModel.findAssistantSnapshotById', () => {
  it('returns only the columns a heterogeneous turn rehydrates from', async () => {
    await serverDB.insert(messages).values({
      content: 'partial answer',
      editorData: { root: 'large' },
      id: 'asst-1',
      metadata: { heteroTextSnapshotSeq: 3, mainMessageId: 'cc-1' },
      model: 'claude-opus',
      provider: 'anthropic',
      reasoning: { content: 'thinking' },
      role: 'assistant',
      search: { citations: [] },
      tools: [{ apiName: 'Bash', arguments: '{}', id: 'call-1', identifier: 'claude-code' }],
      topicId,
      userId,
    });

    expect(await messageModel.findAssistantSnapshotById('asst-1')).toEqual({
      content: 'partial answer',
      metadata: { heteroTextSnapshotSeq: 3, mainMessageId: 'cc-1' },
      model: 'claude-opus',
      provider: 'anthropic',
      reasoning: { content: 'thinking' },
      tools: [{ apiName: 'Bash', arguments: '{}', id: 'call-1', identifier: 'claude-code' }],
    });
  });

  it("returns undefined for a missing id or another user's message", async () => {
    await serverDB.insert(messages).values({
      content: 'secret',
      id: 'asst-foreign',
      role: 'assistant',
      userId: otherUserId,
    });

    expect(await messageModel.findAssistantSnapshotById('asst-missing')).toBeUndefined();
    expect(await messageModel.findAssistantSnapshotById('asst-foreign')).toBeUndefined();
  });
});
