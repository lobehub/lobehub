import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, sessions, subagents, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicRepository } from '../index';

const userId = 'topic-move-user';
const otherUserId = 'topic-move-user-2';
const serverDB: LobeChatDatabase = await getTestDB();
const topicRepo = new TopicRepository(serverDB, userId);

describe('TopicRepository - batchMoveToAgent', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await tx.insert(agents).values([
        { id: 'source-agent', userId, title: 'Source' },
        { id: 'target-agent', userId, title: 'Target' },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('moves topics and their messages to the target agent', async () => {
    await serverDB.transaction(async (tx) => {
      await tx.insert(topics).values([
        { id: 'topic-1', userId, agentId: 'source-agent' },
        { id: 'topic-2', userId, agentId: 'source-agent' },
        { id: 'topic-keep', userId, agentId: 'source-agent' },
      ]);
      await tx.insert(messages).values([
        { id: 'msg-1', userId, role: 'user', topicId: 'topic-1', agentId: 'source-agent' },
        { id: 'msg-2', userId, role: 'assistant', topicId: 'topic-1', agentId: 'source-agent' },
        { id: 'msg-3', userId, role: 'user', topicId: 'topic-2', agentId: 'source-agent' },
        { id: 'msg-keep', userId, role: 'user', topicId: 'topic-keep', agentId: 'source-agent' },
      ]);
    });

    await topicRepo.batchMoveToAgent(['topic-1', 'topic-2'], 'target-agent');

    const movedTopics = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.agentId, 'target-agent'));
    expect(movedTopics.map((t) => t.id).sort()).toEqual(['topic-1', 'topic-2']);

    // The untouched topic still belongs to the source agent.
    const keptTopic = await serverDB.select().from(topics).where(eq(topics.id, 'topic-keep'));
    expect(keptTopic[0].agentId).toBe('source-agent');

    // Messages of moved topics are reassigned; the kept topic's message is not.
    const movedMessages = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.agentId, 'target-agent'));
    expect(movedMessages.map((m) => m.id).sort()).toEqual(['msg-1', 'msg-2', 'msg-3']);

    const keptMessage = await serverDB.select().from(messages).where(eq(messages.id, 'msg-keep'));
    expect(keptMessage[0].agentId).toBe('source-agent');
  });

  it('reassigns threads under the moved topics to the target agent', async () => {
    await serverDB.transaction(async (tx) => {
      await tx.insert(topics).values([
        { id: 'topic-t', userId, agentId: 'source-agent' },
        { id: 'topic-t-keep', userId, agentId: 'source-agent' },
      ]);
      await tx.insert(subagents).values({ id: 'sub-1', name: 'p', parentAgentId: 'source-agent' });
      await tx.insert(threads).values([
        {
          id: 'thread-1',
          userId,
          topicId: 'topic-t',
          type: 'continuation',
          agentId: 'source-agent',
          subagentId: 'sub-1',
        },
        {
          id: 'thread-keep',
          userId,
          topicId: 'topic-t-keep',
          type: 'continuation',
          agentId: 'source-agent',
        },
      ]);
    });

    await topicRepo.batchMoveToAgent(['topic-t'], 'target-agent');

    // Thread under the moved topic follows the topic to the target agent —
    // critical because threads.agentId is a cascade-on-delete FK.
    const [movedThread] = await serverDB.select().from(threads).where(eq(threads.id, 'thread-1'));
    expect(movedThread.agentId).toBe('target-agent');
    // Presets stay with the source agent.
    expect(movedThread.subagentId).toBeNull();

    // A no-op move onto the same agent keeps the attribution.
    await serverDB
      .insert(subagents)
      .values({ id: 'sub-2', name: 'p', parentAgentId: 'target-agent' });
    // Router-created threads carry no agentId, so the check must not rely on it.
    await serverDB
      .update(threads)
      .set({ agentId: null, subagentId: 'sub-2' })
      .where(eq(threads.id, 'thread-1'));
    await topicRepo.batchMoveToAgent(['topic-t'], 'target-agent');
    const [sameAgent] = await serverDB.select().from(threads).where(eq(threads.id, 'thread-1'));
    expect(sameAgent.subagentId).toBe('sub-2');

    // Thread under an untouched topic keeps its source agent.
    const [keptThread] = await serverDB.select().from(threads).where(eq(threads.id, 'thread-keep'));
    expect(keptThread.agentId).toBe('source-agent');
  });

  it('clears sessionId on moved topics and messages to detach from the source session', async () => {
    await serverDB.transaction(async (tx) => {
      await tx.insert(sessions).values([{ id: 'old-session', userId }]);
      await tx
        .insert(topics)
        .values([{ id: 'topic-s', userId, agentId: 'source-agent', sessionId: 'old-session' }]);
      await tx.insert(messages).values([
        {
          id: 'msg-s',
          userId,
          role: 'user',
          topicId: 'topic-s',
          agentId: 'source-agent',
          sessionId: 'old-session',
        },
      ]);
    });

    await topicRepo.batchMoveToAgent(['topic-s'], 'target-agent');

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'topic-s'));
    expect(topic.agentId).toBe('target-agent');
    expect(topic.sessionId).toBeNull();

    const [message] = await serverDB.select().from(messages).where(eq(messages.id, 'msg-s'));
    expect(message.agentId).toBe('target-agent');
    expect(message.sessionId).toBeNull();
  });

  it('does not move topics or messages belonging to another user', async () => {
    await serverDB.transaction(async (tx) => {
      // shared agent ids so the only guard is ownership
      await tx.insert(topics).values([
        { id: 'mine', userId, agentId: 'source-agent' },
        { id: 'theirs', userId: otherUserId, agentId: 'source-agent' },
      ]);
      await tx.insert(messages).values([
        { id: 'msg-mine', userId, role: 'user', topicId: 'mine', agentId: 'source-agent' },
        {
          id: 'msg-theirs',
          userId: otherUserId,
          role: 'user',
          topicId: 'theirs',
          agentId: 'source-agent',
        },
      ]);
    });

    await topicRepo.batchMoveToAgent(['mine', 'theirs'], 'target-agent');

    const [theirTopic] = await serverDB.select().from(topics).where(eq(topics.id, 'theirs'));
    expect(theirTopic.agentId).toBe('source-agent');

    const [theirMsg] = await serverDB.select().from(messages).where(eq(messages.id, 'msg-theirs'));
    expect(theirMsg.agentId).toBe('source-agent');

    const [myTopic] = await serverDB.select().from(topics).where(eq(topics.id, 'mine'));
    expect(myTopic.agentId).toBe('target-agent');
  });

  it('rejects moving to an agent owned by another user and leaves rows untouched', async () => {
    await serverDB.transaction(async (tx) => {
      await tx
        .insert(agents)
        .values([{ id: 'foreign-agent', userId: otherUserId, title: 'Foreign' }]);
      await tx.insert(topics).values([{ id: 'topic-x', userId, agentId: 'source-agent' }]);
      await tx
        .insert(messages)
        .values([
          { id: 'msg-x', userId, role: 'user', topicId: 'topic-x', agentId: 'source-agent' },
        ]);
    });

    await expect(topicRepo.batchMoveToAgent(['topic-x'], 'foreign-agent')).rejects.toThrow();

    // Transaction rolled back — topic and message still point at the source agent.
    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'topic-x'));
    expect(topic.agentId).toBe('source-agent');

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'msg-x'));
    expect(msg.agentId).toBe('source-agent');
  });

  it('is a no-op when given an empty topic list', async () => {
    await serverDB.insert(topics).values([{ id: 'topic-noop', userId, agentId: 'source-agent' }]);

    await topicRepo.batchMoveToAgent([], 'target-agent');

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'topic-noop'));
    expect(topic.agentId).toBe('source-agent');
  });

  it('reassigns agentId, clears sessionId, and moves child messages', async () => {
    await serverDB.insert(agents).values([
      { id: 'agent-src', userId },
      { id: 'agent-dst', userId },
    ]);
    await serverDB.insert(topics).values({
      agentId: 'agent-src',
      id: 'move-1',
      sessionId: null,
      title: 'movable',
      userId,
    });
    await serverDB.insert(messages).values({
      agentId: 'agent-src',
      content: 'm',
      id: 'move-msg',
      role: 'user',
      topicId: 'move-1',
      userId,
    });

    await topicRepo.batchMoveToAgent(['move-1'], 'agent-dst');

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'move-1'));
    expect(topic.agentId).toBe('agent-dst');
    expect(topic.sessionId).toBeNull();

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'move-msg'));
    expect(msg.agentId).toBe('agent-dst');
  });

  it('throws when the target agent is not accessible', async () => {
    await serverDB.insert(agents).values({ id: 'agent-foreign', userId: otherUserId });
    await serverDB.insert(topics).values({ id: 'move-x', title: 'x', userId });

    await expect(topicRepo.batchMoveToAgent(['move-x'], 'agent-foreign')).rejects.toThrow(
      'not found or not accessible',
    );
  });

  it('is a no-op for an empty id list', async () => {
    await expect(topicRepo.batchMoveToAgent([], 'whatever')).resolves.toBeUndefined();
  });
});
