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

// Set up test data
describe('DataExporterRepos', () => {
  // Test data IDs
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

  // Set up test environment
  const userId: string = testIds.userId;

  beforeAll(async () => {
    db = await getTestDB();
  }, 30000);

  const setupTestData = async () => {
    await db.transaction(async (trx) => {
      // User data
      await trx.insert(users).values({
        id: testIds.userId,
        username: 'testuser',
        email: 'test@example.com',
      });

      // User settings
      await trx.insert(userSettings).values({
        id: testIds.userId,
        general: { theme: 'light' },
      });

      // Global files
      await trx.insert(globalFiles).values({
        hashId: testIds.fileHash,
        fileType: 'text/plain',
        size: 1024,
        url: 'https://example.com/test-file.txt',
        creator: testIds.userId,
      });

      // File data
      await trx.insert(files).values({
        id: testIds.fileId,
        userId: testIds.userId,
        fileType: 'text/plain',
        fileHash: testIds.fileHash,
        name: 'test-file.txt',
        size: 1024,
        url: 'https://example.com/test-file.txt',
      });

      // Session groups
      await trx.insert(sessionGroups).values({
        name: 'Test Group',
        userId: testIds.userId,
      });

      // Sessions
      await trx.insert(sessions).values({
        id: testIds.sessionId,
        slug: 'test-session',
        title: 'Test Session',
        userId: testIds.userId,
      });

      // Topics
      await trx.insert(topics).values({
        id: testIds.topicId,
        title: 'Test Topic',
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // Messages
      await trx.insert(messages).values({
        id: testIds.messageId,
        role: 'user',
        content: 'Hello, world!',
        userId: testIds.userId,
        sessionId: testIds.sessionId,
        topicId: testIds.topicId,
      });

      // Agents
      await trx.insert(agents).values({
        id: testIds.agentId,
        title: 'Test Agent',
        userId: testIds.userId,
      });

      // Agent-to-session associations
      await trx.insert(agentsToSessions).values({
        agentId: testIds.agentId,
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // File-to-session associations
      await trx.insert(filesToSessions).values({
        fileId: testIds.fileId,
        sessionId: testIds.sessionId,
        userId: testIds.userId,
      });

      // Knowledge bases
      await trx.insert(knowledgeBases).values({
        id: testIds.knowledgeBaseId,
        name: 'Test Knowledge Base',
        userId: testIds.userId,
      });

      // Knowledge base files
      await trx.insert(knowledgeBaseFiles).values({
        knowledgeBaseId: testIds.knowledgeBaseId,
        fileId: testIds.fileId,
        userId: testIds.userId,
      });

      // Agent knowledge bases
      await trx.insert(agentsKnowledgeBases).values({
        agentId: testIds.agentId,
        knowledgeBaseId: testIds.knowledgeBaseId,
        userId: testIds.userId,
      });
    });
  };

  beforeEach(async () => {
    // Clean up and insert test data
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
      // Create exporter instance
      const dataExporter = new DataExporterRepos(db, userId);

      // Execute export
      const result = await dataExporter.export();

      // Verify base table export results
      // expect(result).toHaveProperty('users');
      // expect(result.users).toHaveLength(1);
      // expect(result.users[0]).toHaveProperty('id', testIds.userId);
      // expect(result.users[0]).not.toHaveProperty('userId'); // the userId field should be removed

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

      // Verify relation table export results
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
      // Clear the database

      await db.delete(users);
      await db.delete(globalFiles);

      // Create exporter instance
      const dataExporter = new DataExporterRepos(db, userId);

      // Execute export
      const result = await dataExporter.export();

      // Verify all tables return empty arrays
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
      // Simulate a query error
      // @ts-ignore
      vi.spyOn(db.query.users, 'findMany').mockRejectedValueOnce(new Error('Database error'));

      // Create exporter instance
      const dataExporter = new DataExporterRepos(db, userId);

      // Execute export
      const result = await dataExporter.export();

      // Verify other tables are still exported
      expect(result).toHaveProperty('sessions');
      expect(result.sessions).toHaveLength(1);
    });

    it('should skip relation tables when source tables have no data', async () => {
      // Delete agents and sessions, so agentsToSessions source tables have no data
      await db.delete(agentsToSessions);
      await db.delete(agents);
      await db.delete(messages);
      await db.delete(topics);
      await db.delete(sessions);

      const dataExporter = new DataExporterRepos(db, userId);
      const result = await dataExporter.export();

      // agentsToSessions should be empty because both source tables have no data
      expect(result).toHaveProperty('agentsToSessions');
      expect(result.agentsToSessions).toEqual([]);
    });

    it('should handle base table query error gracefully', async () => {
      // Mock a specific base table to throw an error
      // @ts-ignore
      vi.spyOn(db.query.userSettings, 'findMany').mockRejectedValueOnce(
        new Error('DB connection failed'),
      );

      const dataExporter = new DataExporterRepos(db, userId);
      const result = await dataExporter.export();

      // userSettings should return empty array due to error handling
      expect(result).toHaveProperty('userSettings');
      expect(result.userSettings).toEqual([]);

      // Other tables should still export successfully
      expect(result.sessions).toHaveLength(1);
    });

    it('should handle relation table query error gracefully', async () => {
      // Mock agentsToSessions query to throw an error
      // @ts-ignore
      vi.spyOn(db.query.agentsToSessions, 'findMany').mockRejectedValueOnce(
        new Error('Relation query failed'),
      );

      const dataExporter = new DataExporterRepos(db, userId);
      const result = await dataExporter.export();

      // agentsToSessions should return empty array due to error handling
      expect(result).toHaveProperty('agentsToSessions');
      expect(result.agentsToSessions).toEqual([]);

      // Base tables should still export successfully
      expect(result.sessions).toHaveLength(1);
    });

    it('should export data for a different user', async () => {
      // Create another user
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

      // Create exporter instance using another user ID
      const dataExporter = new DataExporterRepos(db, anotherUserId);

      // Execute export
      const result = await dataExporter.export();

      // Verify only the other user's data was exported
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
