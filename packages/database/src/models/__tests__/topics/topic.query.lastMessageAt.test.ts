// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TopicRepository } from '../../../repositories/topic';
import { agents, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-last-message-at-user';
const workspaceId = 'topic-last-message-at-workspace';
const agentId = 'topic-last-message-at-agent';

const messageModel = new MessageModel(serverDB, userId);
const topicModel = new TopicModel(serverDB, userId);

const readTopic = async (id: string) => {
  const [row] = await serverDB
    .select({ lastMessageAt: topics.lastMessageAt, updatedAt: topics.updatedAt })
    .from(topics)
    .where(eq(topics.id, id));
  return row;
};

const iso = (value: string) => new Date(value).toISOString();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: `${agentId}-ws`, userId, workspaceId },
  ]);
  await serverDB.insert(topics).values([
    { agentId, id: 'topic-a', updatedAt: new Date('2024-01-01'), userId },
    { agentId, id: 'topic-b', updatedAt: new Date('2024-02-01'), userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('topics.lastMessageAt write path', () => {
  it('create stamps the message time without touching the topic updatedAt', async () => {
    const message = await messageModel.create({
      agentId,
      content: 'hi',
      role: 'user',
      topicId: 'topic-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    const topic = await readTopic('topic-a');
    expect(topic.lastMessageAt?.toISOString()).toBe(message.updatedAt.toISOString());
    expect(topic.lastMessageAt?.toISOString()).toBe(iso('2024-03-01'));
    expect(topic.updatedAt.toISOString()).toBe(iso('2024-01-01'));
  });

  it('createUserAndAssistantMessages stamps the newer of the pair', async () => {
    const { assistantMessage } = await messageModel.createUserAndAssistantMessages({
      assistantMessage: { agentId, content: '', role: 'assistant', topicId: 'topic-a' } as any,
      userMessage: { agentId, content: 'hi', role: 'user', topicId: 'topic-a' } as any,
    });

    const topic = await readTopic('topic-a');
    expect(topic.lastMessageAt?.toISOString()).toBe(assistantMessage.updatedAt.toISOString());
  });

  it('update moves it forward, and a back-dated write never moves it back', async () => {
    const message = await messageModel.create({
      agentId,
      content: 'hi',
      role: 'assistant',
      topicId: 'topic-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    await messageModel.update(message.id, { content: 'streamed reply' });
    const afterUpdate = await readTopic('topic-a');
    expect(afterUpdate.lastMessageAt!.getTime()).toBeGreaterThan(new Date('2024-03-01').getTime());

    await messageModel.create({
      agentId,
      content: 'imported',
      role: 'user',
      topicId: 'topic-a',
      updatedAt: new Date('2020-01-01').getTime(),
    } as any);
    const afterOld = await readTopic('topic-a');
    expect(afterOld.lastMessageAt?.toISOString()).toBe(afterUpdate.lastMessageAt?.toISOString());
    expect(afterOld.updatedAt.toISOString()).toBe(iso('2024-01-01'));
  });

  it('deleting a message leaves it where it was', async () => {
    const message = await messageModel.create({
      agentId,
      content: 'hi',
      role: 'user',
      topicId: 'topic-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    await messageModel.deleteMessage(message.id);

    expect((await readTopic('topic-a')).lastMessageAt?.toISOString()).toBe(iso('2024-03-01'));
  });

  it('batchCreate stamps every topic it writes to', async () => {
    await messageModel.batchCreate([
      {
        content: 'a',
        id: 'm-a',
        role: 'user',
        topicId: 'topic-a',
        updatedAt: new Date('2024-04-01'),
      },
      {
        content: 'b1',
        id: 'm-b1',
        role: 'user',
        topicId: 'topic-b',
        updatedAt: new Date('2024-05-01'),
      },
      {
        content: 'b2',
        id: 'm-b2',
        role: 'user',
        topicId: 'topic-b',
        updatedAt: new Date('2024-06-01'),
      },
    ] as any);

    expect((await readTopic('topic-a')).lastMessageAt?.toISOString()).toBe(iso('2024-04-01'));
    expect((await readTopic('topic-b')).lastMessageAt?.toISOString()).toBe(iso('2024-06-01'));
  });

  it('a duplicated topic takes its activity from the copy, not the source', async () => {
    await serverDB
      .update(topics)
      .set({ lastMessageAt: new Date('2020-01-01') })
      .where(eq(topics.id, 'topic-b'));

    const { topic } = await new TopicRepository(serverDB, userId).duplicate('topic-b');

    expect((await readTopic(topic.id)).lastMessageAt).toBeNull();
  });
});

describe('topic list ordering by topics.lastMessageAt', () => {
  it('orders the agent list by lastMessageAt and returns it as sortUpdatedAt', async () => {
    // topic-b has the newer row updatedAt, but topic-a has the newer message.
    await messageModel.create({
      agentId,
      content: 'hi',
      role: 'user',
      topicId: 'topic-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    const { items } = await topicModel.query({ agentId });

    expect(items.map((t: any) => t.id)).toEqual(['topic-a', 'topic-b']);
    const byId = Object.fromEntries(items.map((t: any) => [t.id, t]));
    expect(byId['topic-a'].sortUpdatedAt.toISOString()).toBe(iso('2024-03-01'));
    expect(byId['topic-a'].updatedAt.toISOString()).toBe(iso('2024-01-01'));
  });

  it('falls back to updatedAt when lastMessageAt is null (not backfilled)', async () => {
    await serverDB
      .update(topics)
      .set({ lastMessageAt: new Date('2023-12-01') })
      .where(eq(topics.id, 'topic-a'));

    const { items } = await topicModel.query({ agentId });

    // topic-b: null → its updatedAt (2024-02) beats topic-a's 2023-12.
    expect(items.map((t: any) => t.id)).toEqual(['topic-b', 'topic-a']);
    const byId = Object.fromEntries(items.map((t: any) => [t.id, t]));
    expect(byId['topic-b'].sortUpdatedAt.toISOString()).toBe(iso('2024-02-01'));
  });

  it('keeps favorites first, then activity', async () => {
    await serverDB.update(topics).set({ favorite: true }).where(eq(topics.id, 'topic-a'));
    await serverDB
      .update(topics)
      .set({ lastMessageAt: new Date('2025-01-01') })
      .where(eq(topics.id, 'topic-b'));

    const { items } = await topicModel.query({ agentId });

    expect(items.map((t: any) => t.id)).toEqual(['topic-a', 'topic-b']);
  });

  it('orders the workspace agent list the same way', async () => {
    const wsAgentId = `${agentId}-ws`;
    await serverDB.insert(topics).values([
      { agentId: wsAgentId, id: 'ws-a', updatedAt: new Date('2024-01-01'), userId, workspaceId },
      { agentId: wsAgentId, id: 'ws-b', updatedAt: new Date('2024-02-01'), userId, workspaceId },
    ]);
    await new MessageModel(serverDB, userId, workspaceId).create({
      agentId: wsAgentId,
      content: 'hi',
      role: 'user',
      topicId: 'ws-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    const { items } = await new TopicModel(serverDB, userId, workspaceId).query({
      agentId: wsAgentId,
    });

    expect(items.map((t: any) => t.id)).toEqual(['ws-a', 'ws-b']);
  });

  it('queryRecent reads the same activity time', async () => {
    await messageModel.create({
      agentId,
      content: 'hi',
      role: 'user',
      topicId: 'topic-a',
      updatedAt: new Date('2024-03-01').getTime(),
    } as any);

    const recent = await topicModel.queryRecent();

    expect(recent[0].id).toBe('topic-a');
    expect(recent[0].updatedAt.toISOString()).toBe(iso('2024-03-01'));
  });
});
