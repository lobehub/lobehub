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

  // Create test data
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

  describe('import with empty tables', () => {
    it('should skip tables with empty data', async () => {
      const data: ImportPgDataStructure = {
        data: {
          agents: [],
          sessions: [],
          sessionGroups: [],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      // No results should be returned for empty tables
      expect(Object.keys(result.results)).toHaveLength(0);
    });
  });

  describe('import with sessionGroups (relation mapping)', () => {
    it('should import sessions with sessionGroup relations', async () => {
      const data: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_rel_test',
              slug: 'rel-test-agent',
              model: 'gpt-4',
              provider: 'openai',
              systemRole: '',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          agentsToSessions: [{ agentId: 'agt_rel_test', sessionId: 'ssn_rel_test' }],
          sessionGroups: [
            {
              id: 'sg_test1',
              name: 'Test Group',
              sort: 0,
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          sessions: [
            {
              id: 'ssn_rel_test',
              slug: 'rel-test-session',
              type: 'agent',
              groupId: 'sg_test1',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.sessionGroups).toMatchObject({ added: 1, errors: 0 });
      expect(result.results.sessions).toMatchObject({ added: 1, errors: 0 });

      // Verify the session's groupId was mapped to the new sessionGroup ID
      const sessions = await clientDB.query.sessions.findMany({
        where: eq(Schema.sessions.userId, userId),
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].groupId).not.toBeNull();
    });

    it('should set relation to null when group mapping not found', async () => {
      // Import a session with a groupId that has no corresponding sessionGroup in the import data
      // The code handles this by: if idMaps[sessionGroups] exists but mappedId is undefined → set to null
      // However, if sessionGroups was never imported, idMaps[sessionGroups] won't exist and groupId stays as-is
      // Let's import sessionGroups first (empty) to ensure the map exists, then sessions with unmapped groupId
      const data: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_nomap',
              slug: 'nomap-agent',
              model: 'gpt-4',
              provider: 'openai',
              systemRole: '',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          agentsToSessions: [{ agentId: 'agt_nomap', sessionId: 'ssn_nomap' }],
          sessionGroups: [
            {
              id: 'sg_exists',
              name: 'Exists Group',
              sort: 0,
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          sessions: [
            {
              id: 'ssn_nomap',
              slug: 'nomap-session',
              type: 'agent',
              groupId: 'non_existent_group',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.sessions).toMatchObject({ added: 1, errors: 0 });

      // Session should be imported but groupId should be null (unmapped)
      const sessions = await clientDB.query.sessions.findMany({
        where: eq(Schema.sessions.userId, userId),
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].groupId).toBeNull();
    });
  });

  describe('import with self-references', () => {
    it('should nullify self-reference fields (parentId, quotaId)', async () => {
      const data: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_selfref',
              slug: 'selfref-agent',
              model: 'gpt-4',
              provider: 'openai',
              systemRole: '',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          agentsToSessions: [{ agentId: 'agt_selfref', sessionId: 'ssn_selfref' }],
          sessions: [
            {
              id: 'ssn_selfref',
              slug: 'selfref-session',
              type: 'agent',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          messages: [
            {
              id: 'msg_selfref_1',
              role: 'user',
              content: 'Hello',
              sessionId: 'ssn_selfref',
              parentId: 'msg_selfref_parent',
              quotaId: 'msg_selfref_quota',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const result = await importer.importPgData(data);

      expect(result.success).toBe(true);
      expect(result.results.messages).toMatchObject({ added: 1, errors: 0 });

      // Verify self-reference fields are set to null
      const messages = await clientDB.query.messages.findMany({
        where: eq(Schema.messages.userId, userId),
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].parentId).toBeNull();
      expect(messages[0].quotaId).toBeNull();
    });
  });

  describe('import with override conflict strategy', () => {
    it('should apply field processor when overriding duplicate slug', async () => {
      // First, create an agent with a specific slug
      const firstData: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_override1',
              slug: 'override-test-slug',
              model: 'gpt-4',
              provider: 'openai',
              systemRole: '',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
          agentsToSessions: [],
          sessions: [],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      await importer.importPgData(firstData);

      // Now create a new importer and import a DIFFERENT agent with the same slug
      const importer2 = new DataImporterRepos(clientDB, userId);
      const secondData: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_override2',
              slug: 'override-test-slug',
              model: 'gpt-4',
              provider: 'openai',
              systemRole: '',
              createdAt: '2025-01-02T00:00:00Z',
              updatedAt: '2025-01-02T00:00:00Z',
            },
          ],
          agentsToSessions: [],
          sessions: [],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      // Default conflictStrategy for agents is 'override' (no conflictStrategy in config = default 'override')
      const result = await importer2.importPgData(secondData);

      expect(result.success).toBe(true);
      // The override strategy should apply the field processor (appends UUID suffix to slug)
      expect(result.results.agents).toMatchObject({ added: 1, errors: 0 });

      const agents = await clientDB.query.agents.findMany({
        where: eq(Schema.agents.userId, userId),
      });
      expect(agents).toHaveLength(2);
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
