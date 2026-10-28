// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'plugin-lookup-user';
const otherUserId = 'plugin-lookup-other-user';

const messageModel = new MessageModel(serverDB, userId);

interface SeedArgs {
  content?: string;
  createdAt?: Date;
  id: string;
  identifier?: string | null;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  parentId?: string;
  plugin?: boolean;
  /** Owner of the plugin row only, so the two ownership guards can be probed apart. */
  pluginOwnerId?: string;
  state?: Record<string, unknown>;
  toolCallId?: string | null;
  topicId?: string | null;
  type?: string | null;
}

const seedAssistantMessage = async (id: string) => {
  await serverDB.insert(messages).values({
    content: 'assistant',
    id,
    role: 'assistant',
    topicId: 'plugin-topic',
    userId,
  });
};

const seedToolMessage = async (args: SeedArgs) => {
  const owner = args.ownerId ?? userId;

  await serverDB.insert(messages).values({
    content: args.content ?? 'tool output',
    createdAt: args.createdAt ?? new Date('2026-10-01T00:00:00Z'),
    id: args.id,
    metadata: args.metadata,
    parentId: args.parentId,
    role: 'tool',
    topicId: args.topicId === undefined ? 'plugin-topic' : args.topicId,
    userId: owner,
  });

  if (args.plugin === false) return;

  await serverDB.insert(messagePlugins).values({
    apiName: args.id,
    id: args.id,
    identifier: args.identifier === undefined ? 'lobe-tool' : args.identifier,
    state: args.state,
    toolCallId: args.toolCallId === undefined ? `tc-${args.id}` : args.toolCallId,
    type: args.type === undefined ? undefined : args.type,
    userId: args.pluginOwnerId ?? owner,
  });
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'plugin-topic', userId },
    { id: 'plugin-topic-2', userId },
    { id: 'plugin-other-topic', userId: otherUserId },
    // Agent-share visitor topic: owned by the creator, authored by a visitor.
    { id: 'plugin-visitor-topic', senderId: 'visitor-1', userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.findMessagePlugin', () => {
  it('returns undefined when the message has no plugin row', async () => {
    await seedToolMessage({ id: 'plug-missing', plugin: false });

    expect(await messageModel.findMessagePlugin('plug-missing')).toBeUndefined();
  });

  it('normalizes nullable columns into optional fields', async () => {
    await seedToolMessage({
      id: 'plug-nullable',
      identifier: null,
      toolCallId: null,
      type: null,
    });

    await expect(messageModel.findMessagePlugin('plug-nullable')).resolves.toEqual({
      apiName: 'plug-nullable',
      arguments: undefined,
      clientId: undefined,
      error: undefined,
      id: 'plug-nullable',
      identifier: undefined,
      intervention: undefined,
      state: undefined,
      toolCallId: undefined,
      // A null `type` column falls back to the model's default label.
      type: 'default',
      userId,
    });
  });

  it('returns the stored tool-call metadata', async () => {
    await seedToolMessage({
      id: 'plug-full',
      state: { running: true },
      toolCallId: 'tc-full',
      type: 'default',
    });

    await expect(messageModel.findMessagePlugin('plug-full')).resolves.toEqual({
      apiName: 'plug-full',
      arguments: undefined,
      clientId: undefined,
      error: undefined,
      id: 'plug-full',
      identifier: 'lobe-tool',
      intervention: undefined,
      state: { running: true },
      toolCallId: 'tc-full',
      type: 'default',
      userId,
    });
  });

  it("ignores another user's plugin row", async () => {
    await seedToolMessage({
      id: 'plug-other',
      ownerId: otherUserId,
      topicId: 'plugin-other-topic',
    });

    expect(await messageModel.findMessagePlugin('plug-other')).toBeUndefined();
  });
});

describe('MessageModel.listMessagePluginsByTopic', () => {
  it('returns the topic rows in first-seen order with metadata', async () => {
    await seedToolMessage({
      createdAt: new Date('2026-10-01T00:00:02Z'),
      id: 'plug-b',
      metadata: { phase: 'second' },
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      createdAt: new Date('2026-10-01T00:00:01Z'),
      id: 'plug-a',
      metadata: { phase: 'first' },
      topicId: 'plugin-topic',
    });
    // No plugin row: the inner join must skip it.
    await seedToolMessage({
      createdAt: new Date('2026-10-01T00:00:03Z'),
      id: 'plug-no-plugin',
      plugin: false,
      topicId: 'plugin-topic',
    });

    const rows = await messageModel.listMessagePluginsByTopic('plugin-topic');

    expect(rows.map((row) => row.id)).toEqual(['plug-a', 'plug-b']);
    expect(rows[0].metadata).toEqual({ phase: 'first' });
    expect(rows[0]).toMatchObject({ identifier: 'lobe-tool', type: 'default', userId });
  });

  it('breaks createdAt ties by id', async () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    await seedToolMessage({ createdAt, id: 'plug-tie-b', topicId: 'plugin-topic' });
    await seedToolMessage({ createdAt, id: 'plug-tie-a', topicId: 'plugin-topic' });

    const rows = await messageModel.listMessagePluginsByTopic('plugin-topic');

    expect(rows.map((row) => row.id)).toEqual(['plug-tie-a', 'plug-tie-b']);
  });

  it('excludes rows from other topics, other users and visitor topics', async () => {
    await seedToolMessage({ id: 'plug-in-scope', topicId: 'plugin-topic' });
    await seedToolMessage({ id: 'plug-other-topic', topicId: 'plugin-topic-2' });
    // Inside the requested topic, so the topic pin cannot reject them: only the
    // ownership guards can. One row breaks each guard on its own.
    await seedToolMessage({
      id: 'plug-topic-other-user',
      ownerId: otherUserId,
      pluginOwnerId: otherUserId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      id: 'plug-topic-other-message',
      ownerId: otherUserId,
      pluginOwnerId: userId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      id: 'plug-topic-other-plugin',
      pluginOwnerId: otherUserId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({ id: 'plug-visitor', topicId: 'plugin-visitor-topic' });

    const rows = await messageModel.listMessagePluginsByTopic('plugin-topic');

    expect(rows.map((row) => row.id)).toEqual(['plug-in-scope']);

    // The visitor topic has to be queried on its own, so the topic pin cannot
    // stand in for the visitor guard.
    await expect(messageModel.listMessagePluginsByTopic('plugin-visitor-topic')).resolves.toEqual(
      [],
    );
  });

  it('returns an empty list for an unknown topic', async () => {
    await seedToolMessage({ id: 'plug-known', topicId: 'plugin-topic' });

    await expect(messageModel.listMessagePluginsByTopic('plugin-unknown')).resolves.toEqual([]);
  });
});

describe('MessageModel.listMessagePluginsByIds', () => {
  it('returns an empty list without querying when ids are empty', async () => {
    await expect(
      messageModel.listMessagePluginsByIds({ ids: [], topicId: 'plugin-topic' }),
    ).resolves.toEqual([]);
  });

  it('returns requested rows ordered by createdAt then id', async () => {
    await seedToolMessage({
      content: 'stdout of b',
      createdAt: new Date('2026-10-01T00:00:02Z'),
      id: 'plug-ids-b',
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      content: 'stdout of a',
      createdAt: new Date('2026-10-01T00:00:01Z'),
      id: 'plug-ids-a',
      state: { done: true },
      topicId: 'plugin-topic',
    });

    const rows = await messageModel.listMessagePluginsByIds({
      ids: ['plug-ids-b', 'plug-ids-a'],
      topicId: 'plugin-topic',
    });

    expect(rows.map((row) => row.id)).toEqual(['plug-ids-a', 'plug-ids-b']);
    expect(rows[0]).toMatchObject({
      content: 'stdout of a',
      createdAt: new Date('2026-10-01T00:00:01Z'),
      identifier: 'lobe-tool',
      state: { done: true },
      type: 'default',
      userId,
    });
  });

  it('pins the result to the given topic', async () => {
    await seedToolMessage({ id: 'plug-pin', topicId: 'plugin-topic-2' });

    await expect(
      messageModel.listMessagePluginsByIds({ ids: ['plug-pin'], topicId: 'plugin-topic' }),
    ).resolves.toEqual([]);
  });

  it('excludes other users and visitor-topic rows', async () => {
    await seedToolMessage({ id: 'plug-mine', topicId: 'plugin-topic' });
    // Seeded inside the requested topic, so the topic pin cannot reject them:
    // the ownership guards are the only thing standing between these rows and
    // the result. One row breaks each guard on its own, so dropping either
    // predicate alone turns this test red.
    await seedToolMessage({
      id: 'plug-theirs',
      ownerId: otherUserId,
      pluginOwnerId: otherUserId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      id: 'plug-theirs-message',
      ownerId: otherUserId,
      pluginOwnerId: userId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      id: 'plug-theirs-plugin',
      pluginOwnerId: otherUserId,
      topicId: 'plugin-topic',
    });
    await seedToolMessage({ id: 'plug-visitor-call', topicId: 'plugin-visitor-topic' });

    const rows = await messageModel.listMessagePluginsByIds({
      ids: ['plug-mine', 'plug-theirs', 'plug-theirs-message', 'plug-theirs-plugin'],
      topicId: 'plugin-topic',
    });

    expect(rows.map((row) => row.id)).toEqual(['plug-mine']);

    // The visitor topic has to be queried on its own: the topic pin hides these
    // rows from the topic above, so only a direct query proves the visitor
    // guard is load-bearing.
    await expect(
      messageModel.listMessagePluginsByIds({
        ids: ['plug-visitor-call', 'plug-mine'],
        topicId: 'plugin-visitor-topic',
      }),
    ).resolves.toEqual([]);
  });
});

describe('MessageModel.findToolMessageIdByToolCallId', () => {
  it('resolves the message id for a tool call id', async () => {
    await seedToolMessage({ id: 'plug-tc-a', toolCallId: 'call-1', topicId: 'plugin-topic' });

    await expect(messageModel.findToolMessageIdByToolCallId('call-1')).resolves.toBe('plug-tc-a');
  });

  it('returns null when nothing matches', async () => {
    await seedToolMessage({ id: 'plug-tc-b', toolCallId: 'call-2', topicId: 'plugin-topic' });

    await expect(messageModel.findToolMessageIdByToolCallId('call-unknown')).resolves.toBeNull();
  });

  it('restricts the match to one assistant parent when parentId is given', async () => {
    await seedAssistantMessage('assistant-a');
    await seedAssistantMessage('assistant-b');

    await seedToolMessage({
      id: 'plug-tc-parent-a',
      parentId: 'assistant-a',
      toolCallId: 'call-reused',
      topicId: 'plugin-topic',
    });
    await seedToolMessage({
      id: 'plug-tc-parent-b',
      parentId: 'assistant-b',
      toolCallId: 'call-reused',
      topicId: 'plugin-topic',
    });

    await expect(
      messageModel.findToolMessageIdByToolCallId('call-reused', 'assistant-b'),
    ).resolves.toBe('plug-tc-parent-b');
    await expect(
      messageModel.findToolMessageIdByToolCallId('call-reused', 'assistant-unknown'),
    ).resolves.toBeNull();
  });

  it("ignores another user's tool call", async () => {
    await seedToolMessage({
      id: 'plug-tc-other',
      ownerId: otherUserId,
      toolCallId: 'call-other',
      topicId: 'plugin-other-topic',
    });

    await expect(messageModel.findToolMessageIdByToolCallId('call-other')).resolves.toBeNull();
  });
});
