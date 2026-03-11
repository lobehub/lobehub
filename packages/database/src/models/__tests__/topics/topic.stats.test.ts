import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, agentsToSessions, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-stats-user';
const userId2 = 'topic-stats-user-2';
const sessionId = 'topic-stats-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Stats', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('count', () => {
    it('should return total number of topics', async () => {
      await serverDB.insert(topics).values([
        { id: 'abc_topic1', sessionId, userId },
        { id: 'abc_topic2', sessionId, userId },
      ]);

      const result = await topicModel.count();

      expect(result).toBe(2);
    });

    describe('count with agentId', () => {
      it('should count topics with direct agentId match', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(agents).values([
            { id: 'count-agent-1', userId, title: 'Count Agent 1' },
            { id: 'count-agent-2', userId, title: 'Count Agent 2' },
          ]);
          await trx.insert(topics).values([
            { id: 'count-topic-1', userId, agentId: 'count-agent-1' },
            { id: 'count-topic-2', userId, agentId: 'count-agent-1' },
            { id: 'count-topic-3', userId, agentId: 'count-agent-2' },
          ]);
        });

        const result = await topicModel.count({ agentId: 'count-agent-1' });
        expect(result).toBe(2);
      });

      it('should count legacy topics via agentsToSessions lookup', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'count-legacy-session', userId }]);
          await trx
            .insert(agents)
            .values([{ id: 'count-legacy-agent', userId, title: 'Legacy Agent' }]);
          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'count-legacy-agent', sessionId: 'count-legacy-session', userId }]);
          await trx.insert(topics).values([
            { id: 'legacy-count-1', userId, sessionId: 'count-legacy-session', agentId: null },
            { id: 'legacy-count-2', userId, sessionId: 'count-legacy-session', agentId: null },
          ]);
        });

        const result = await topicModel.count({ agentId: 'count-legacy-agent' });
        expect(result).toBe(2);
      });

      it('should count both new and legacy topics', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'count-mixed-session', userId }]);
          await trx
            .insert(agents)
            .values([{ id: 'count-mixed-agent', userId, title: 'Mixed Agent' }]);
          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'count-mixed-agent', sessionId: 'count-mixed-session', userId }]);
          await trx.insert(topics).values([
            { id: 'mixed-count-legacy', userId, sessionId: 'count-mixed-session', agentId: null },
            { id: 'mixed-count-new', userId, agentId: 'count-mixed-agent', sessionId: null },
          ]);
        });

        const result = await topicModel.count({ agentId: 'count-mixed-agent' });
        expect(result).toBe(2);
      });

      it('should return 0 when agent has no topics', async () => {
        await serverDB.insert(agents).values([{ id: 'empty-agent', userId, title: 'Empty Agent' }]);

        const result = await topicModel.count({ agentId: 'empty-agent' });
        expect(result).toBe(0);
      });
    });
  });

  describe('count with date filters', () => {
    beforeEach(async () => {
      await serverDB.insert(topics).values([
        { id: 'topic1', userId, createdAt: new Date('2023-01-01') },
        { id: 'topic2', userId, createdAt: new Date('2023-02-01') },
        { id: 'topic3', userId, createdAt: new Date('2023-03-01') },
      ]);
    });

    it('should count topics with start date filter', async () => {
      const result = await topicModel.count({ startDate: '2023-02-01' });

      expect(result).toBe(2);
    });

    it('should count topics with end date filter', async () => {
      const result = await topicModel.count({ endDate: '2023-02-01' });

      expect(result).toBe(2);
    });

    it('should count topics within date range', async () => {
      const result = await topicModel.count({ range: ['2023-01-15', '2023-02-15'] });

      expect(result).toBe(1);
    });

    it('should return 0 if no topics match date filters', async () => {
      const result = await topicModel.count({ range: ['2024-01-01', '2024-12-31'] });

      expect(result).toBe(0);
    });

    it('should handle invalid date filters gracefully', async () => {
      const result = await topicModel.count({ startDate: 'invalid-date' });

      expect(result).toBe(3);
    });
  });

  describe('rank', () => {
    it('should return ranked topics based on message count', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values([
          { id: 'topic1', title: 'Topic 1', sessionId, userId },
          { id: 'topic2', title: 'Topic 2', sessionId, userId },
          { id: 'topic3', title: 'Topic 3', sessionId, userId },
        ]);

        await tx.insert(messages).values([
          { id: 'msg1', role: 'user', topicId: 'topic1', userId },
          { id: 'msg2', role: 'assistant', topicId: 'topic1', userId },
          { id: 'msg3', role: 'user', topicId: 'topic1', userId },
        ]);

        await tx.insert(messages).values([
          { id: 'msg4', role: 'user', topicId: 'topic2', userId },
          { id: 'msg5', role: 'assistant', topicId: 'topic2', userId },
        ]);

        await tx.insert(messages).values([{ id: 'msg6', role: 'user', topicId: 'topic3', userId }]);
      });

      const result = await topicModel.rank(2);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'topic1',
        title: 'Topic 1',
        count: 3,
        sessionId,
      });
      expect(result[1]).toMatchObject({
        id: 'topic2',
        title: 'Topic 2',
        count: 2,
        sessionId,
      });
    });

    it('should return empty array if no topics exist', async () => {
      const result = await topicModel.rank();
      expect(result).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values([
          { id: 'topic1', title: 'Topic 1', sessionId, userId },
          { id: 'topic2', title: 'Topic 2', sessionId, userId },
        ]);

        await tx.insert(messages).values([
          { id: 'msg1', role: 'user', topicId: 'topic1', userId },
          { id: 'msg2', role: 'user', topicId: 'topic2', userId },
        ]);
      });

      const result = await topicModel.rank(1);

      expect(result).toHaveLength(1);
    });
  });
});
