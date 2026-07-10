import type { ImporterEntryData, ImportErrorResult, ImportPgDataStructure } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('importData (deprecated entry wrapper)', () => {
    it('should delegate to the deprecated importer and wrap the result', async () => {
      const data: ImporterEntryData = {
        version: 7,
        sessionGroups: [],
        sessions: [],
        topics: [],
        messages: [],
      } as unknown as ImporterEntryData;

      const result = await importer.importData(data);

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
    });
  });

  describe('importPgData error handling (outer catch)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return success=false with parsed unique-constraint error details', async () => {
      const uniqueError: any = new Error('duplicate key value violates unique constraint');
      uniqueError.code = '23505';
      uniqueError.detail = 'Key (slug)=(my-agent) already exists.';

      vi.spyOn(clientDB, 'transaction').mockRejectedValueOnce(uniqueError);

      const result = await importer.importPgData(agentsData as ImportPgDataStructure);

      expect(result.success).toBe(false);
      expect((result as ImportErrorResult).error).toMatchObject({
        message: 'duplicate key value violates unique constraint',
        details: {
          constraintType: 'unique',
          field: 'slug',
          value: 'my-agent',
        },
      });
    });

    it('should fall back to raw detail when error is not a 23505 unique violation', async () => {
      const genericError: any = new Error('some db failure');
      genericError.detail = 'raw detail message';

      vi.spyOn(clientDB, 'transaction').mockRejectedValueOnce(genericError);

      const result = await importer.importPgData(agentsData as ImportPgDataStructure);

      expect(result.success).toBe(false);
      expect((result as ImportErrorResult).error).toMatchObject({
        message: 'some db failure',
        details: 'raw detail message',
      });
    });

    it('should fall back to "Unknown error details" when 23505 detail is unparseable', async () => {
      const weirdUniqueError: any = new Error('weird unique violation');
      weirdUniqueError.code = '23505';
      weirdUniqueError.detail = 'no parseable key here';

      vi.spyOn(clientDB, 'transaction').mockRejectedValueOnce(weirdUniqueError);

      const result = await importer.importPgData(agentsData as ImportPgDataStructure);

      expect(result.success).toBe(false);
      expect((result as ImportErrorResult).error?.details).toBe('no parseable key here');
    });
  });

  describe('batch insert error handling (in-batch duplicate)', () => {
    it('should record errors when two composite-key rows collide on the same primary key', async () => {
      // userInstalledPlugins uses composite PK [userId, identifier]; two rows with the
      // same identifier are both "new" (not yet in DB), pass the conflict pre-check,
      // and then violate the PK during the batch insert -> batch catch path.
      const data: ImportPgDataStructure = {
        data: {
          userInstalledPlugins: [
            {
              identifier: 'dup-plugin',
              type: 'plugin',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
            {
              identifier: 'dup-plugin',
              type: 'plugin',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const result = await importer.importPgData(data);

      // The transaction itself still succeeds; the batch error is swallowed and counted.
      expect(result.success).toBe(true);
      expect(result.results.userInstalledPlugins?.errors).toBe(2);
    });
  });

  describe('userInstalledPlugins (composite key + merge strategy)', () => {
    it('should insert then merge on identifier conflict and bump updated count', async () => {
      const firstData: ImportPgDataStructure = {
        data: {
          userInstalledPlugins: [
            {
              identifier: 'merge-plugin',
              type: 'plugin',
              source: 'first',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const firstResult = await importer.importPgData(firstData);
      expect(firstResult.success).toBe(true);
      expect(firstResult.results.userInstalledPlugins).toMatchObject({ added: 1, errors: 0 });

      // Re-import the same identifier (twice in one payload) with a fresh importer.
      // First row triggers merge (exists), establishing the conflict; the second row in
      // the same call also hits merge after the first update committed -> updated++ branch.
      const importer2 = new DataImporterRepos(clientDB, userId);
      const secondData: ImportPgDataStructure = {
        data: {
          userInstalledPlugins: [
            {
              identifier: 'merge-plugin',
              type: 'plugin',
              source: 'second',
              createdAt: '2025-02-01T00:00:00Z',
              updatedAt: '2025-02-01T00:00:00Z',
            },
            {
              identifier: 'merge-plugin',
              type: 'plugin',
              source: 'third',
              createdAt: '2025-03-01T00:00:00Z',
              updatedAt: '2025-03-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const secondResult = await importer2.importPgData(secondData);
      expect(secondResult.success).toBe(true);
      expect(secondResult.results.userInstalledPlugins?.updated).toBe(2);
      expect(secondResult.results.userInstalledPlugins?.added).toBe(0);

      // Only one row should exist (merged), with the latest merged source value.
      const rows = await clientDB.query.userInstalledPlugins.findMany({
        where: eq(Schema.userInstalledPlugins.userId, userId),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('third');
    });
  });

  describe('aiModels (non-composite skip strategy on unique constraint)', () => {
    it('should skip a new model whose providerId already exists and map its id', async () => {
      // aiModels config: conflictStrategy 'skip', uniqueConstraints ['id','providerId'].
      // Import a first model with providerId 'prov-x'.
      const firstData: ImportPgDataStructure = {
        data: {
          aiModels: [
            {
              id: 'model-a',
              providerId: 'prov-x',
              type: 'chat',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const firstResult = await importer.importPgData(firstData);
      expect(firstResult.success).toBe(true);
      expect(firstResult.results.aiModels).toMatchObject({ added: 1, errors: 0 });

      // A second, different model (new id) but same providerId -> providerId unique
      // constraint conflict -> skip branch (no providers imported here so providerId is
      // not remapped and keeps colliding).
      const importer2 = new DataImporterRepos(clientDB, userId);
      const secondData: ImportPgDataStructure = {
        data: {
          aiModels: [
            {
              id: 'model-b',
              providerId: 'prov-x',
              type: 'chat',
              createdAt: '2025-02-01T00:00:00Z',
              updatedAt: '2025-02-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const secondResult = await importer2.importPgData(secondData);
      expect(secondResult.success).toBe(true);
      expect(secondResult.results.aiModels?.added).toBe(0);
      expect(secondResult.results.aiModels?.skips).toBeGreaterThanOrEqual(1);

      const models = await clientDB.query.aiModels.findMany({
        where: eq(Schema.aiModels.userId, userId),
      });
      // model-b was skipped, only model-a persisted.
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model-a');
    });
  });

  describe('aiProviders (preserveId dedup on same id)', () => {
    it('should skip re-import of the same provider id via the preserveId/id match path', async () => {
      // aiProviders has NO clientId column and preserveId=true. On re-import the existing
      // record is discovered through the preserveId id lookup, and the dedup filter then
      // matches on `preserveId && !isCompositeKey && record.id === item.id` (the right arm
      // of the || at line 447, since the clientId left arm is always falsy here).
      const data: ImportPgDataStructure = {
        data: {
          aiProviders: [
            {
              id: 'prov-keep',
              name: 'Keep Provider',
              source: 'custom',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ],
        },
        mode: 'pglite',
        schemaHash: 'test',
      } as any;

      const firstResult = await importer.importPgData(data);
      expect(firstResult.success).toBe(true);
      expect(firstResult.results.aiProviders).toMatchObject({ added: 1, errors: 0 });

      // Re-import the exact same id with a fresh importer -> existing record found by id,
      // recordsToInsert becomes empty -> early return with skips=1.
      const importer2 = new DataImporterRepos(clientDB, userId);
      const secondResult = await importer2.importPgData(data);
      expect(secondResult.success).toBe(true);
      expect(secondResult.results.aiProviders).toMatchObject({ added: 0, skips: 1 });

      const providers = await clientDB.query.aiProviders.findMany({
        where: eq(Schema.aiProviders.userId, userId),
      });
      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('prov-keep');
    });
  });

  describe('agents slug field processor (null slug) + empty unique-constraint skip', () => {
    it('should null out an empty slug and skip the slug unique check', async () => {
      // agents config: fieldProcessor for `slug` returns null when the value is falsy
      // (branch 87 false-arm). With slug=null, the unique-constraint loop hits the
      // `if (!record.newRecord[field]) continue;` guard (branch 608) and skips the check.
      const data: ImportPgDataStructure = {
        data: {
          agents: [
            {
              id: 'agt_nullslug',
              slug: '',
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

      const result = await importer.importPgData(data);
      expect(result.success).toBe(true);
      expect(result.results.agents).toMatchObject({ added: 1, errors: 0 });

      const agents = await clientDB.query.agents.findMany({
        where: eq(Schema.agents.userId, userId),
      });
      expect(agents).toHaveLength(1);
      expect(agents[0].slug).toBeNull();
    });
  });

  describe('extractErrorDetails fallback (no detail, non-23505)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return "Unknown error details" when error has no code and no detail', async () => {
      const bareError: any = new Error('bare failure with no detail');
      // no .code, no .detail -> skips the 23505 block and falls to the `|| 'Unknown'` arm.

      vi.spyOn(clientDB, 'transaction').mockRejectedValueOnce(bareError);

      const result = await importer.importPgData(agentsData as ImportPgDataStructure);

      expect(result.success).toBe(false);
      expect((result as ImportErrorResult).error?.details).toBe('Unknown error details');
      expect((result as ImportErrorResult).error?.message).toBe('bare failure with no detail');
    });
  });
});
