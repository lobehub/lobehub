import { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreateMessageParams, MessageModel } from '../message';

describe('MessageModel', () => {
  let messageData: CreateMessageParams;

  beforeEach(() => {
    // 设置正确结构的消息数据
    messageData = {
      content: 'Test message content',
      role: 'user',
      sessionId: 'session1',
      topicId: 'topic1',
    };
  });

  afterEach(async () => {
    // 每次测试后清理数据库
    await MessageModel.clearTable();
  });

  describe('create', () => {
    it('should create a message record', async () => {
      const result = await MessageModel.create(messageData);

      expect(result).toHaveProperty('id');
      // 验证消息是否已添加到数据库
      const messageInDb = await MessageModel.findById(result.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          content: messageData.content,
          role: messageData.role,
          sessionId: messageData.sessionId,
          topicId: messageData.topicId,
        }),
      );
    });

    it('should create with tts', async () => {
      const result = await MessageModel.create({
        content: 'abc',
        role: 'assistant',
        extra: { translate: { content: 'avc', from: 'a', to: 'f' } },
        sessionId: 'a',
      });

      // 验证消息是否已添加到数据库
      const messageInDb = await MessageModel.findById(result.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          content: 'abc',
          role: 'assistant',
          translate: { content: 'avc', from: 'a', to: 'f' },
          sessionId: 'a',
        }),
      );
    });
  });

  describe('batchCreate', () => {
    it('should batch create message records', async () => {
      const messagesToCreate = [messageData, messageData] as UIChatMessage[];
      const results = await MessageModel.batchCreate(messagesToCreate);

      expect(results.success).toBeTruthy();
      expect(results.errors).toBeUndefined();

      // 验证消息是否已添加到数据库
      for (const message of results.ids!) {
        const messageInDb = await MessageModel.findById(message);
        expect(messageInDb).toEqual(
          expect.objectContaining({
            content: messageData.content,
            role: messageData.role,
            sessionId: messageData.sessionId,
            topicId: messageData.topicId,
          }),
        );
      }
    });
  });

  describe('query', () => {
    it('should query messages with pagination', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([messageData, messageData] as UIChatMessage[]);

      const queriedMessages = await MessageModel.query({
        pageSize: 1,
        current: 0,
        sessionId: messageData.sessionId,
        topicId: messageData.topicId,
      });

      expect(queriedMessages).toHaveLength(1);
    });

    it('should query correctly without topic id', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([messageData, messageData] as UIChatMessage[]);

      const queriedMessages = await MessageModel.query({ sessionId: messageData.sessionId });

      expect(queriedMessages).toHaveLength(0);
    });

    it('should query correctly with exactly topic id', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([
        messageData,
        { ...messageData, topicId: undefined },
      ] as UIChatMessage[]);

      const queriedMessages = await MessageModel.query({ sessionId: messageData.sessionId });

      expect(queriedMessages).toHaveLength(1);
    });

    it('should should have correct order', async () => {
      const data: UIChatMessage[] = [
        {
          role: 'user',
          content: '1',
          createdAt: 1697120044345,
          id: 'NQ7RscYx',
          updatedAt: 1697120181827,
          extra: {},
          meta: {},
          sessionId: '1',
        },
        {
          role: 'assistant',
          content: '2',
          parentId: 'NQ7RscYx',
          createdAt: 1697120130973,
          id: '9tDAumEx',
          updatedAt: 1697120181827,
          meta: {},
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          sessionId: '1',
        },
        {
          role: 'assistant',
          content: '3',
          parentId: 'tOMH7c5R',
          meta: {},
          createdAt: 1697120163272,
          id: '5Ie5hClg',
          updatedAt: 1697120181827,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          sessionId: '1',
        },
        {
          role: 'user',
          content: '4',
          meta: {},
          createdAt: 1697120163272,
          id: 'tOMH7c5R',
          updatedAt: 1697120181827,
          extra: {},
          sessionId: '1',
        },
      ];

      await MessageModel.batchCreate(data);

      const queriedMessages = await MessageModel.query({ sessionId: '1' });

      expect(queriedMessages).toEqual([
        {
          role: 'user',
          content: '1',
          createdAt: 1697120044345,
          id: 'NQ7RscYx',
          updatedAt: 1697120181827,
          sessionId: '1',
          extra: {},
          meta: {},
        },
        {
          role: 'assistant',
          content: '2',
          parentId: 'NQ7RscYx',
          createdAt: 1697120130973,
          id: '9tDAumEx',
          sessionId: '1',
          updatedAt: 1697120181827,
          meta: {},
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
        },
        {
          role: 'user',
          content: '4',
          sessionId: '1',
          createdAt: 1697120163272,
          id: 'tOMH7c5R',
          updatedAt: 1697120181827,
          meta: {},
          extra: {},
        },
        {
          role: 'assistant',
          content: '3',
          parentId: 'tOMH7c5R',
          meta: {},
          createdAt: 1697120163272,
          sessionId: '1',
          id: '5Ie5hClg',
          updatedAt: 1697120181827,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
        },
      ]);
    });
  });

  describe('findById', () => {
    it('should find a message by id', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const messageInDb = await MessageModel.findById(createdMessage.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          id: createdMessage.id,
          content: messageData.content,
        }),
      );
    });
  });

  describe('delete', () => {
    it('should delete a message', async () => {
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.delete(createdMessage.id);

      const messageInDb = await MessageModel.findById(createdMessage.id);
      expect(messageInDb).toBeUndefined();
    });
  });

  describe('bulkDelete', () => {
    it('should delete many messages', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);
      await MessageModel.bulkDelete([createdMessage.id, createdMessage2.id]);

      const messageInDb1 = await MessageModel.findById(createdMessage.id);
      const messageInDb2 = await MessageModel.findById(createdMessage2.id);
      expect(messageInDb1).toBeUndefined();
      expect(messageInDb2).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a message', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const updateData = { content: 'Updated content' };

      await MessageModel.update(createdMessage.id, updateData);
      const updatedMessage = await MessageModel.findById(createdMessage.id);

      expect(updatedMessage).toHaveProperty('content', 'Updated content');
    });

    it('should update a role and plugins', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const updateData = {
        role: 'tool' as const,
        plugin: { apiName: 'a', identifier: 'b', arguments: 'abc' },
      };

      await MessageModel.update(createdMessage.id, updateData);
      const updatedMessage = await MessageModel.findById(createdMessage.id);

      expect(updatedMessage).toHaveProperty('role', 'tool');
    });
  });

  describe('batchUpdate', () => {
    it('should batch update messages', async () => {
      const createdMessage1 = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);
      const updateData = { content: 'Batch updated content' };

      const numUpdated = await MessageModel.batchUpdate(
        [createdMessage1.id, createdMessage2.id],
        updateData,
      );

      expect(numUpdated).toBe(2);

      const updatedMessage1 = await MessageModel.findById(createdMessage1.id);
      const updatedMessage2 = await MessageModel.findById(createdMessage2.id);

      expect(updatedMessage1).toHaveProperty('content', 'Batch updated content');
      expect(updatedMessage2).toHaveProperty('content', 'Batch updated content');
    });
  });

  describe('batchDelete', () => {
    it('should batch delete messages by session id', async () => {
      // 创建多条消息以测试批量删除方法
      const createdMessage1 = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);

      await MessageModel.batchDelete(messageData.sessionId, undefined);

      // 验证所有具有给定会话 ID 的消息是否已删除
      const messagesInDb = await MessageModel.query({ sessionId: messageData.sessionId });
      expect(messagesInDb).toHaveLength(0);
    });

    it('should batch delete messages by session id and topic id', async () => {
      // 创建多条消息以测试批量删除方法
      const createdMessage1 = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);

      await MessageModel.batchDelete(messageData.sessionId, messageData.topicId);

      // 验证所有具有给定会话 ID 和话题 ID 的消息是否已删除
      const messagesInDb = await MessageModel.query({
        sessionId: messageData.sessionId,
        topicId: messageData.topicId,
      });
      expect(messagesInDb).toHaveLength(0);
    });
  });

  describe('duplicateMessages', () => {
    it('should duplicate messages and update parentId for copied messages', async () => {
      // 创建原始消息和父消息
      const parentMessageData: CreateMessageParams = {
        content: 'Parent message content',
        role: 'user',
        sessionId: 'session1',
        topicId: undefined,
      };
      const parentMessage = await MessageModel.create(parentMessageData);

      const childMessageData: CreateMessageParams = {
        content: 'Child message content',
        role: 'user',
        sessionId: 'session1',
        parentId: parentMessage.id,
      };

      await MessageModel.create(childMessageData);

      // 获取数据库中的消息以进行复制
      const originalMessages = await MessageModel.queryAll();

      // 执行复制操作
      const duplicatedMessages = await MessageModel.duplicateMessages(originalMessages);

      // 验证复制的消息数量是否正确
      expect(duplicatedMessages.length).toBe(originalMessages.length);

      // 验证每个复制的消息是否具有新的唯一ID，并且parentId被正确更新
      for (const original of originalMessages) {
        const copied = duplicatedMessages.find((m) => m.content === original.content);
        expect(copied).toBeDefined();
        expect(copied).not.toBeNull();
        expect(copied!.id).not.toBe(original.id);
        if (original.parentId) {
          const originalParent = originalMessages.find((m) => m.id === original.parentId);
          expect(originalParent).toBeDefined();
          const copiedParent = duplicatedMessages.find(
            (m) => m.content === originalParent!.content,
          );

          expect(copied!.parentId).toBe(copiedParent!.id);
        }
      }
    });
  });

  describe('clearTable', () => {
    it('should clear the table', async () => {
      await MessageModel.create(messageData);
      await MessageModel.clearTable();
      const messages = await MessageModel.queryAll();
      expect(messages).toHaveLength(0);
    });
  });

  describe('updatePluginState', () => {
    it('should update plugin state', async () => {
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.updatePluginState(createdMessage.id, { testKey: 'testValue' });
      const updatedMessage = await MessageModel.findById(createdMessage.id);
      expect(updatedMessage.pluginState).toHaveProperty('testKey', 'testValue');
    });
  });

  describe('updatePlugin', () => {
    it('should update plugin', async () => {
      const value = {
        identifier: 'testValue',
        arguments: 'abc',
        apiName: 'abc',
      };
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.updatePlugin(createdMessage.id, value);
      const updatedMessage = await MessageModel.findById(createdMessage.id);
      expect(updatedMessage.plugin).toEqual(value);
    });
  });

  describe('isEmpty', () => {
    it('should return true if table is empty', async () => {
      const number = await MessageModel.count();
      expect(number === 0).toBeTruthy();
    });
  });
});
