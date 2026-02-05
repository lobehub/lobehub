import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentsKnowledgeBases,
  agentsToSessions,
  files,
  filesToSessions,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  sessionGroups,
  sessions,
  topics,
  users,
  userSettings,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DATA_EXPORT_CONFIG, DataExporterRepos } from './index';

let db: LobeChatDatabase;

// 设置测试数据
describe('DataExporterRepos', () => {
  // 测试数据 ID
  const testIds = {
    userId: 'test-user-id',
    fileId: 'test-file-id',
    fileHash: 'test-file-hash',
    sessionId: 'test-session-id',
    agentId: 'test-agent-id',
    topicId: 'test-topic-id',
    messageId: 'test-message-id',
    knowledgeBaseId: 'test-kb-id',
  };

  // 设置测试环境
  const userId: string = testIds.userId;

  beforeAll(async () => {
    db = await getTestDB();
  }, 30000);

  const setupTestData = async () => {
    await db.transaction(async (trx) => {
      // 用户数据
      await trx.insert(users).values({
        id: testIds.userId,
        username: 'testuser',
        email: 'test@example.com',
      });

      // 用户设置
      await trx.insert(userSettings).values({
        id: testIds.userId,
        general: { theme: 'light' },
      });

      // 全局文件
      await trx.insert(globalFiles).values({
        hashId: testIds.fileHash,
        fileType: 'text/plain',
        size: 1024,
        url: 'https://example.com/test-file.txt',
        creator: testIds.userId,
      });

      // 文件数据
      await trx.insert(files).values({
        id: testIds.fileId,
        userId: testIds.userId,
        fileType: 'text/plain',
        fileHash: testIds.fileHash,
        name: 'test-file.txt',
        size: 1024,
        url: 'https://example.com/test-file.txt',
      });

      // 会话组
      await trx.insert(sessionGroups).values({
        name: 'Test Group',
        userId: testIds.userId,
      });

      // 会话
      await trx.insert(sessions).values({
        id: testIds.sessionId,
        slug: 'test-session',
        title: 'Test Session',
        userId: testIds.userId,
      });

      // 主题
      await trx.insert(topics).values({
        id: testIds.topicId,
        title: 'Test Topic',
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // 消息
      await trx.insert(messages).values({
        id: testIds.messageId,
        role: 'user',
        content: 'Hello, world!',
        userId: testIds.userId,
        sessionId: testIds.sessionId,
        topicId: testIds.topicId,
      });

      // 代理
      await trx.insert(agents).values({
        id: testIds.agentId,
        title: 'Test Agent',
        userId: testIds.userId,
      });

      // 代理到会话的关联
      await trx.insert(agentsToSessions).values({
        agentId: testIds.agentId,
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // 文件到会话的关联
      await trx.insert(filesToSessions).values({
        fileId: testIds.fileId,
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // 知识库
      await trx.insert(knowledgeBases).values({
        id: testIds.knowledgeBaseId,
        name: 'Test Knowledge Base',
        userId: testIds.userId,
      });

      // 知识库文件
      await trx.insert(knowledgeBaseFiles).values({
        knowledgeBaseId: testIds.knowledgeBaseId,
        fileId: testIds.fileId,
        userId: testIds.userId,
      });

      // 代理知识库
      await trx.insert(agentsKnowledgeBases).values({
        agentId: testIds.agentId,
        knowledgeBaseId: testIds.knowledgeBaseId,
        userId: testIds.userId,
      });
    });
  };

  beforeEach(async () => {
    // 清理并插入测试数据
    await db.delete(users);
    await db.delete(globalFiles);
    await setupTestData();
  }, 30000);

  afterEach(async () => {
    await db.delete(users);
    await db.delete(globalFiles);

    vi.restoreAllMocks();
  });

  describe('export', () => {
    it('should export all user data correctly', async () => {
      // 创建导出器实例
      const dataExporter = new DataExporterRepos(db, userId);

      // 执行导出
      const result = await dataExporter.export();

      // 验证基础表导出结果
      // expect(result).toHaveProperty('users');
      // expect(result.users).toHaveLength(1);
      // expect(result.users[0]).toHaveProperty('id', testIds.userId);
      // expect(result.users[0]).not.toHaveProperty('userId'); // userId 字段应该被移除

      expect(result).toHaveProperty('userSettings');
      expect(result.userSettings).toHaveLength(1);
      expect(result.userSettings[0]).toHaveProperty('id', testIds.userId);

      // expect(result).toHaveProperty('files');
      // expect(result.files).toHaveLength(1);
      // expect(result.files[0]).toHaveProperty('id', testIds.fileId);
      // expect(result.files[0]).toHaveProperty('fileHash', testIds.fileHash);
      // expect(result.files[0]).not.toHaveProperty('userId');

      expect(result).toHaveProperty('sessions');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toHaveProperty('id', testIds.sessionId);

      expect(result).toHaveProperty('topics');
      expect(result.topics).toHaveLength(1);
      expect(result.topics[0]).toHaveProperty('id', testIds.topicId);

      expect(result).toHaveProperty('messages');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toHaveProperty('id', testIds.messageId);

      expect(result).toHaveProperty('agents');
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]).toHaveProperty('id', testIds.agentId);

      // expect(result).toHaveProperty('knowledgeBases');
      // expect(result.knowledgeBases).toHaveLength(1);
      // expect(result.knowledgeBases[0]).toHaveProperty('id', testIds.knowledgeBaseId);

      // 验证关联表导出结果
      // expect(result).toHaveProperty('globalFiles');
      // expect(result.globalFiles).toHaveLength(1);
      // expect(result.globalFiles[0]).toHaveProperty('hashId', testIds.fileHash);

      expect(result).toHaveProperty('agentsToSessions');
      expect(result.agentsToSessions).toHaveLength(1);
      expect(result.agentsToSessions[0]).toHaveProperty('agentId', testIds.agentId);
      expect(result.agentsToSessions[0]).toHaveProperty('sessionId', testIds.sessionId);

      // expect(result).toHaveProperty('filesToSessions');
      // expect(result.filesToSessions).toHaveLength(1);
      // expect(result.filesToSessions[0]).toHaveProperty('fileId', testIds.fileId);
      // expect(result.filesToSessions[0]).toHaveProperty('sessionId', testIds.sessionId);

      // expect(result).toHaveProperty('knowledgeBaseFiles');
      // expect(result.knowledgeBaseFiles).toHaveLength(1);
      // expect(result.knowledgeBaseFiles[0]).toHaveProperty(
      //   'knowledgeBaseId',
      //   testIds.knowledgeBaseId,
      // );
      // expect(result.knowledgeBaseFiles[0]).toHaveProperty('fileId', testIds.fileId);
    });

    it('should handle empty database gracefully', async () => {
      // 清空数据库

      await db.delete(users);
      await db.delete(globalFiles);

      // 创建导出器实例
      const dataExporter = new DataExporterRepos(db, userId);

      // 执行导出
      const result = await dataExporter.export();

      // 验证所有表都返回空数组
      DATA_EXPORT_CONFIG.baseTables.forEach(({ table }) => {
        expect(result).toHaveProperty(table);
        expect(result[table]).toEqual([]);
      });

      DATA_EXPORT_CONFIG.relationTables.forEach(({ table }) => {
        expect(result).toHaveProperty(table);
        expect(result[table]).toEqual([]);
      });
    });

    it('should handle database query errors', async () => {
      // 模拟查询错误
      // @ts-ignore
      vi.spyOn(db.query.users, 'findMany').mockRejectedValueOnce(new Error('Database error'));

      // 创建导出器实例
      const dataExporter = new DataExporterRepos(db, userId);

      // 执行导出
      const result = await dataExporter.export();

      // 验证其他表仍然被导出
      expect(result).toHaveProperty('sessions');
      expect(result.sessions).toHaveLength(1);
    });

    it.skip('should skip relation tables when source tables have no data', async () => {
      // 删除文件数据，这将导致 globalFiles 表被跳过
      await db.delete(files);

      // 创建导出器实例
      const dataExporter = new DataExporterRepos(db, userId);

      // 执行导出
      const result = await dataExporter.export();

      // 验证文件表为空
      // expect(result).toHaveProperty('files');
      // expect(result.files).toEqual([]);

      // 验证关联表也为空
      // expect(result).toHaveProperty('globalFiles');
      // expect(result.globalFiles).toEqual([]);
    });

    it('should export data for a different user', async () => {
      // 创建另一个用户
      const anotherUserId = 'another-user-id';
      await db.transaction(async (trx) => {
        await trx.insert(users).values({
          id: anotherUserId,
          username: 'anotheruser',
          email: 'another@example.com',
        });
        await trx.insert(sessions).values({
          id: 'another-session-id',
          slug: 'another-session',
          title: 'Another Session',
          userId: anotherUserId,
        });
      });

      // 创建导出器实例，使用另一个用户 ID
      const dataExporter = new DataExporterRepos(db, anotherUserId);

      // 执行导出
      const result = await dataExporter.export();

      // 验证只导出了另一个用户的数据
      // expect(result).toHaveProperty('users');
      // expect(result.users).toHaveLength(1);
      // expect(result.users[0]).toHaveProperty('id', anotherUserId);

      expect(result).toHaveProperty('sessions');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).not.toHaveProperty('userId', anotherUserId);
      expect(result.sessions[0]).toHaveProperty('id', 'another-session-id');
    });
  });
});
