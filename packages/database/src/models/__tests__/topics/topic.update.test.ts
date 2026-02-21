import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-update-user';
const sessionId = 'topic-update-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Update', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('update', () => {
    it('should update a topic', async () => {
      const topicId = '123';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test',
        favorite: false,
      });

      expect(item).toHaveLength(1);
      expect(item[0].title).toBe('Updated Test');
      expect(item[0].favorite).toBeFalsy();
    });

    it('should not update a topic if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: '456' }]);
      const topicId = '123';
      await serverDB
        .insert(topics)
        .values({ userId: '456', id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test Session',
      });

      expect(item).toHaveLength(0);
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata on a topic with no existing metadata', async () => {
      const topicId = 'metadata-test-1';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test' });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ workingDirectory: '/path/to/dir' });
    });

    it('should merge metadata with existing metadata', async () => {
      const topicId = 'metadata-test-2';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { model: 'gpt-4', provider: 'openai' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        workingDirectory: '/new/path',
      });
    });

    it('should overwrite existing metadata fields when updating', async () => {
      const topicId = 'metadata-test-3';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { workingDirectory: '/old/path', model: 'gpt-4' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        workingDirectory: '/new/path',
      });
    });

    it('should not update metadata if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: 'other-user' }]);
      const topicId = 'metadata-test-4';
      await serverDB.insert(topics).values({
        userId: 'other-user',
        id: topicId,
        title: 'Test',
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(0);
    });
  });
});
