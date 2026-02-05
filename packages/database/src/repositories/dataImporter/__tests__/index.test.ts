import type { ImportPgDataStructure } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as Schema from '../../../schemas';
import { DataImporterRepos } from '../index';
import agentsData from './fixtures/agents.json';
import agentsToSessionsData from './fixtures/agentsToSessions.json';
import topicsData from './fixtures/topic.json';
import userSettingsData from './fixtures/userSettings.json';

const clientDB = await getTestDB();

const userId = 'test-user-id';
let importer: DataImporterRepos;

beforeEach(async () => {
  await clientDB.delete(Schema.users);

  // 创建测试数据
  await clientDB.transaction(async (tx) => {
    await tx.insert(Schema.users).values({ id: userId });
  });

  importer = new DataImporterRepos(clientDB, userId);
});
afterEach(async () => {
  await clientDB.delete(Schema.users);
});

describe('DataImporter', () => {
  describe('import userSettings', () => {
    const data = userSettingsData as ImportPgDataStructure;
    it('should import userSettings correctly', async () => {
      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.userSettings).toMatchObject({ added: 1, errors: 0, skips: 0 });

      const res = await clientDB.query.userSettings.findMany({
        where: eq(Schema.userSettings.id, userId),
      });
      expect(res).toHaveLength(1);
      expect(res[0].general).toEqual({ fontSize: 12 });
    });

    it('should merge exist userSettings correctly', async () => {
      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.userSettings).values({ id: userId, general: { fontSize: 24 } });
        await tx
          .update(Schema.userSettings)
          .set({ general: { fontSize: 24 } })
          .where(eq(Schema.userSettings.id, userId));
      });

      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.userSettings).toMatchObject({
        updated: 1,
        errors: 0,
        skips: 0,
        added: 0,
      });

      const res = await clientDB.query.userSettings.findMany({
        where: eq(Schema.userSettings.id, userId),
      });
      expect(res).toHaveLength(1);
      expect(res[0].general).toEqual({ fontSize: 12 });
    });
  });

  describe('import agents and sessions', () => {
    it('should import return correct result', async () => {
      const data = agentsData as ImportPgDataStructure;
      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.agents).toMatchObject({ added: 1, errors: 0, skips: 0 });

      const agentRes = await clientDB.query.agents.findMany({
        where: eq(Schema.agents.userId, userId),
      });
      const sessionRes = await clientDB.query.sessions.findMany({
        where: eq(Schema.sessions.userId, userId),
      });
      const agentsToSessionRes = await clientDB.query.agentsToSessions.findMany({
        where: eq(Schema.agentsToSessions.userId, userId),
      });

      expect(agentRes).toHaveLength(1);
      expect(sessionRes).toHaveLength(1);
      expect(agentsToSessionRes).toHaveLength(1);
      expect(agentsToSessionRes[0]).toMatchObject({
        agentId: agentRes[0].id,
        sessionId: sessionRes[0].id,
      });

      expect(agentRes[0].clientId).toEqual(agentsData.data.agents[0].id);
      expect(sessionRes[0].clientId).toEqual(agentsData.data.sessions[0].id);
    });

    it('should skip duplicated data by default', async () => {
      const data = agentsData as ImportPgDataStructure;
      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.agents).toMatchObject({ added: 1, errors: 0, skips: 0 });

      // import again to make sure it skip duplicated by default
      const result2 = await importer.importPgData(data);
      expect(result2.success).toBe(true);
      expect(result2.results).toEqual({
        agents: { added: 0, errors: 0, skips: 1, updated: 0 },
        agentsToSessions: { added: 0, errors: 0, skips: 1, updated: 0 },
        sessions: { added: 0, errors: 0, skips: 1, updated: 0 },
      });
    });

    it('should import without agentToSessions error', async () => {
      const data = agentsToSessionsData as ImportPgDataStructure;
      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.agentsToSessions).toMatchObject({ added: 9, errors: 0, skips: 0 });

      // import again to make sure it skip duplicated by default
      const result2 = await importer.importPgData(data);
      expect(result2.success).toBe(true);
      expect(result2.results).toEqual({
        agents: { added: 0, errors: 0, skips: 9, updated: 0 },
        agentsToSessions: { added: 0, errors: 0, skips: 9, updated: 0 },
        sessions: { added: 0, errors: 0, skips: 9, updated: 0 },
      });
    });
  });

  describe('import message and topic', () => {
    it('should import return correct result', async () => {
      const exportData = topicsData as ImportPgDataStructure;
      const result = await importer.importPgData(exportData);

      expect(result.success).toBe(true);
      expect(result.results.messages).toMatchObject({ added: 6, errors: 0, skips: 0 });

      const messageRes = await clientDB.query.messages.findMany({
        where: eq(Schema.agents.userId, userId),
      });
      const topicRes = await clientDB.query.topics.findMany({
        where: eq(Schema.sessions.userId, userId),
      });

      expect(topicRes).toHaveLength(1);
      expect(messageRes).toHaveLength(6);

      expect(topicRes[0].clientId).toEqual(topicsData.data.topics[0].id);
      expect(
        messageRes.find((msg) => msg.content === topicsData.data.messages[0].content)?.clientId,
      ).toEqual(topicsData.data.messages[0].id);
    });

    it('should only return non-zero result', async () => {
      const exportData = topicsData as ImportPgDataStructure;
      const result = await importer.importPgData(exportData);

      expect(result.success).toBe(true);
      expect(result.results).toEqual({
        agents: { added: 1, errors: 0, skips: 0, updated: 0 },
        agentsToSessions: { added: 1, errors: 0, skips: 0, updated: 0 },
        messagePlugins: { added: 1, errors: 0, skips: 0, updated: 0 },
        messages: { added: 6, errors: 0, skips: 0, updated: 0 },
        sessions: { added: 1, errors: 0, skips: 0, updated: 0 },
        topics: { added: 1, errors: 0, skips: 0, updated: 0 },
      });
    });
  });
});
