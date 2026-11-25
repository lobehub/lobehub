import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users } from '../../schemas';
import { TopicModel } from '../topic';
import { MessageModel } from './index';

const db = await getTestDB();
const userId = 'conversation-mode-owner';
const otherId = 'conversation-mode-other';
const model = new MessageModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
  await db.insert(topics).values({ id: 'mode-topic', metadata: { boundDeviceId: 'keep' }, userId });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherId));
});

const topic = async () => (await db.select().from(topics).where(eq(topics.id, 'mode-topic')))[0];

describe('conversation mode commit', () => {
  it('only snapshots a legacy mode when the topic already has a user turn', async () => {
    const topicModel = new TopicModel(db, userId);
    expect(await topicModel.resolveConversationMode('mode-topic', 'chat')).toBe('chat');
    expect((await topic()).metadata?.conversationMode).toBeUndefined();
    await model.create({ content: 'legacy', role: 'user', topicId: 'mode-topic' });
    expect(await topicModel.resolveConversationMode('mode-topic', 'chat')).toBe('chat');
    expect(await topicModel.resolveConversationMode('mode-topic', 'agent')).toBe('chat');
    expect((await topic()).metadata?.conversationMode).toBe('chat');
  });
  it('locks the first user intent and rejects a conflicting turn without inserting either message', async () => {
    await model.create({
      content: 'hello',
      metadata: { conversationMode: 'chat' },
      role: 'user',
      topicId: 'mode-topic',
    });
    await expect(
      model.createUserAndAssistantMessages({
        assistantMessage: { content: '', role: 'assistant', topicId: 'mode-topic' },
        userMessage: {
          content: 'run',
          metadata: { conversationMode: 'agent' },
          role: 'user',
          topicId: 'mode-topic',
        },
      }),
    ).rejects.toThrow('Conversation mode is locked');

    expect((await topic()).metadata).toMatchObject({
      conversationMode: 'chat',
      boundDeviceId: 'keep',
    });
    expect(await db.select().from(messages).where(eq(messages.topicId, 'mode-topic'))).toHaveLength(
      1,
    );
  });

  it('rolls the mode back if saving a message relation fails', async () => {
    await expect(
      model.create({
        content: 'hello',
        files: ['missing-file'],
        metadata: { conversationMode: 'chat' },
        role: 'user',
        topicId: 'mode-topic',
      }),
    ).rejects.toThrow();
    expect((await topic()).metadata?.conversationMode).toBeUndefined();
    await model.create({
      content: 'try again',
      metadata: { conversationMode: 'agent' },
      role: 'user',
      topicId: 'mode-topic',
    });
    expect((await topic()).metadata?.conversationMode).toBe('agent');
  });

  it('does not lock a welcome message or an assistant placeholder', async () => {
    await model.create({
      content: 'welcome',
      metadata: { conversationMode: 'agent' },
      role: 'assistant',
      topicId: 'mode-topic',
    });
    expect((await topic()).metadata?.conversationMode).toBeUndefined();
    await model.create({
      content: 'hello',
      metadata: { conversationMode: 'chat' },
      role: 'user',
      topicId: 'mode-topic',
    });
    expect((await topic()).metadata?.conversationMode).toBe('chat');
  });

  it('cannot lock or append a turn to another user topic', async () => {
    await expect(
      new MessageModel(db, otherId).create({
        content: 'intrusion',
        metadata: { conversationMode: 'chat' },
        role: 'user',
        topicId: 'mode-topic',
      }),
    ).rejects.toThrow();
    expect((await topic()).metadata?.conversationMode).toBeUndefined();
    expect(await db.select().from(messages).where(eq(messages.topicId, 'mode-topic'))).toHaveLength(
      0,
    );
  });

  it('serializes conflicting first sends so only one mode commits', async () => {
    const results = await Promise.allSettled(
      (['chat', 'agent'] as const).map((conversationMode) =>
        model.create({
          content: conversationMode,
          metadata: { conversationMode },
          role: 'user',
          topicId: 'mode-topic',
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.select().from(messages).where(eq(messages.topicId, 'mode-topic'));
    expect(rows).toHaveLength(1);
    expect((await topic()).metadata?.conversationMode).toBe(rows[0].content);
  });

  it('preserves the committed mode across stale metadata replacement and merge', async () => {
    await model.create({
      content: 'hello',
      metadata: { conversationMode: 'chat' },
      role: 'user',
      topicId: 'mode-topic',
    });
    const topicModel = new TopicModel(db, userId);
    await topicModel.update('mode-topic', { metadata: { conversationMode: 'agent' } });
    expect((await topic()).metadata?.conversationMode).toBe('chat');
    await topicModel.updateMetadata('mode-topic', { conversationMode: 'agent' });
    expect((await topic()).metadata?.conversationMode).toBe('chat');
  });
});
