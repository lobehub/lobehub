// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { KnowledgeBaseModel } from '../../../models/knowledgeBase';
import {
  AGENT_SKILL_TEMPLATE_ID,
  agentDocuments,
  agents,
  agentsKnowledgeBases,
  documents,
  knowledgeBases,
  SKILL_MANAGEMENT_SOURCE,
  SKILL_MANAGEMENT_SOURCE_TYPE,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentSpaceRepository } from '../index';

const db: LobeChatDatabase = await getTestDB();

const userId = 'agent-space-user';
const otherUserId = 'agent-space-other-user';
const agentId = 'agt_space_1';
const repository = new AgentSpaceRepository(db, userId);
const isServerDB = process.env.TEST_SERVER_DB === '1';
const editedAt = new Date('2024-01-02T03:04:05.000Z');

const insertDocument = async (
  id: string,
  overrides: Partial<typeof documents.$inferInsert> = {},
  binding: Partial<typeof agentDocuments.$inferInsert> | null = {},
) => {
  await db.insert(documents).values({
    fileType: 'custom/document',
    id,
    source: `agent-document://${agentId}/${id}.md`,
    sourceType: 'agent',
    title: id,
    totalCharCount: 0,
    totalLineCount: 0,
    updatedAt: editedAt,
    userId,
    ...overrides,
  });
  if (binding)
    await db.insert(agentDocuments).values({ agentId, documentId: id, userId, ...binding });
};

const knowledgeBaseIdOf = async (id: string) => {
  const [row] = await db
    .select({ knowledgeBaseId: documents.knowledgeBaseId })
    .from(documents)
    .where(eq(documents.id, id));
  return row.knowledgeBaseId;
};

beforeEach(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(agents).values({ id: agentId, title: 'Writer', userId });
});

describe('AgentSpaceRepository', () => {
  describe('ensure', () => {
    it('creates one hidden, disabled space per agent even under concurrent calls', async () => {
      const ids = await Promise.all([
        repository.ensure(agentId),
        repository.ensure(agentId),
        repository.ensure(agentId),
      ]);

      expect(new Set(ids).size).toBe(1);
      const spaces = await db
        .select()
        .from(knowledgeBases)
        .where(eq(knowledgeBases.userId, userId));
      expect(spaces).toHaveLength(1);
      expect(spaces[0]).toMatchObject({
        name: 'Writer',
        settings: { owner: { id: agentId, type: 'agent' } },
        type: 'agent',
      });
      await expect(
        db.select().from(agentsKnowledgeBases).where(eq(agentsKnowledgeBases.agentId, agentId)),
      ).resolves.toMatchObject([{ enabled: false, knowledgeBaseId: ids[0] }]);
      await expect(new KnowledgeBaseModel(db, userId).query()).resolves.toEqual([]);
    });

    it('does not create a space for an agent the caller cannot see', async () => {
      await expect(
        new AgentSpaceRepository(db, otherUserId).ensure(agentId),
      ).resolves.toBeUndefined();
      await expect(
        db.select().from(knowledgeBases).where(eq(knowledgeBases.userId, userId)),
      ).resolves.toEqual([]);
    });

    it('does not reveal an existing space to a caller who cannot see the agent', async () => {
      await repository.ensure(agentId);
      const outsider = new AgentSpaceRepository(db, otherUserId);

      await expect(outsider.findId(agentId)).resolves.toBeUndefined();
      await expect(outsider.ensure(agentId)).resolves.toBeUndefined();
    });

    it('does not mistake an ordinary mounted library for the space', async () => {
      await db.insert(knowledgeBases).values({ id: 'kb-mounted', name: 'Mounted', userId });
      await db
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb-mounted', userId });

      await expect(repository.findId(agentId)).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns only the spaces of agents the caller can see, with agent identity', async () => {
      const spaceId = await repository.ensure(agentId);
      await db.insert(knowledgeBases).values({ id: 'kb-plain', name: 'Plain', userId });
      await db
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb-plain', userId });

      await expect(repository.list()).resolves.toMatchObject([
        { agentId, id: spaceId, title: 'Writer' },
      ]);
      await expect(new AgentSpaceRepository(db, otherUserId).list()).resolves.toEqual([]);
    });
  });

  describe('list in a workspace', () => {
    it('hides a public agent whose space is still private to its creator', async () => {
      const workspaceId = 'ws-agent-space';
      await db.insert(workspaces).values({
        id: workspaceId,
        name: 'Team',
        primaryOwnerId: userId,
        slug: 'agent-space-team',
      });
      await db.insert(agents).values({
        id: 'agt_space_ws',
        title: 'Team agent',
        userId,
        visibility: 'public',
        workspaceId,
      });
      await db.insert(knowledgeBases).values({
        id: 'kb-private-space',
        name: 'Team agent',
        settings: { owner: { id: 'agt_space_ws', type: 'agent' } },
        type: 'agent',
        userId,
        visibility: 'private',
        workspaceId,
      });
      await db.insert(agentsKnowledgeBases).values({
        agentId: 'agt_space_ws',
        enabled: false,
        knowledgeBaseId: 'kb-private-space',
        userId,
        workspaceId,
      });

      await expect(new AgentSpaceRepository(db, userId, workspaceId).list()).resolves.toHaveLength(
        1,
      );
      await expect(new AgentSpaceRepository(db, otherUserId, workspaceId).list()).resolves.toEqual(
        [],
      );
    });
  });

  describe('migrateBatch', () => {
    it('moves dedicated documents, including soft-deleted bindings, and keeps updatedAt', async () => {
      await insertDocument('doc-a');
      await insertDocument('doc-trashed', {}, { deletedAt: new Date() });

      const result = await repository.migrateBatch(agentId);

      const spaceId = await repository.findId(agentId);
      expect(spaceId).toBeDefined();
      expect(result).toEqual({ done: true, migrated: 2, skipped: false });
      await expect(knowledgeBaseIdOf('doc-a')).resolves.toBe(spaceId);
      await expect(knowledgeBaseIdOf('doc-trashed')).resolves.toBe(spaceId);
      const [row] = await db.select().from(documents).where(eq(documents.id, 'doc-a'));
      expect(row.updatedAt).toEqual(editedAt);
    });

    it('migrates managed skills only when this agent owns the binding', async () => {
      const skill = {
        source: SKILL_MANAGEMENT_SOURCE,
        sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
      } as const;
      await insertDocument('skill-owned', skill, { templateId: AGENT_SKILL_TEMPLATE_ID });
      await insertDocument('skill-borrowed', skill);

      await repository.migrateBatch(agentId);

      await expect(knowledgeBaseIdOf('skill-owned')).resolves.toBeTruthy();
      await expect(knowledgeBaseIdOf('skill-borrowed')).resolves.toBeNull();
    });

    it('leaves associated documents and documents already in a library untouched', async () => {
      await db.insert(knowledgeBases).values({ id: 'kb-home', name: 'Home', userId });
      await insertDocument('doc-page', { source: 'page', sourceType: 'api' });
      await insertDocument('doc-other-agent', { source: 'agent-document://agt_space_2/x.md' });
      // `_` must match literally: this source would pass a LIKE prefix for agt_space_1.
      await insertDocument('doc-like-wildcard', { source: 'agent-document://agtXspace_1/x.md' });
      await insertDocument('doc-in-library', { knowledgeBaseId: 'kb-home' });

      await expect(repository.migrateBatch(agentId)).resolves.toEqual({
        done: true,
        migrated: 0,
        skipped: false,
      });

      await expect(knowledgeBaseIdOf('doc-page')).resolves.toBeNull();
      await expect(knowledgeBaseIdOf('doc-other-agent')).resolves.toBeNull();
      await expect(knowledgeBaseIdOf('doc-like-wildcard')).resolves.toBeNull();
      await expect(knowledgeBaseIdOf('doc-in-library')).resolves.toBe('kb-home');
      await expect(repository.findId(agentId)).resolves.toBeUndefined();
    });

    it('resumes across batches, stays correct half-migrated, and is idempotent', async () => {
      for (const id of ['doc-1', 'doc-2', 'doc-3']) await insertDocument(id);

      await expect(repository.migrateBatch(agentId, 2)).resolves.toEqual({
        done: false,
        migrated: 2,
        skipped: false,
      });
      await expect(knowledgeBaseIdOf('doc-3')).resolves.toBeNull();
      await expect(
        db.select().from(agentDocuments).where(eq(agentDocuments.agentId, agentId)),
      ).resolves.toHaveLength(3);

      await expect(repository.migrateBatch(agentId, 2)).resolves.toEqual({
        done: true,
        migrated: 1,
        skipped: false,
      });
      await expect(repository.migrateBatch(agentId, 2)).resolves.toEqual({
        done: true,
        migrated: 0,
        skipped: false,
      });
      await expect(
        db.select().from(knowledgeBases).where(eq(knowledgeBases.userId, userId)),
      ).resolves.toHaveLength(1);
    });

    it('picks up a document written after the agent finished migrating', async () => {
      await insertDocument('doc-first');
      await repository.migrateBatch(agentId);

      await insertDocument('doc-straggler');
      await repository.migrateBatch(agentId);

      await expect(knowledgeBaseIdOf('doc-straggler')).resolves.toBe(
        await repository.findId(agentId),
      );
    });

    // Try-lock needs a second session to observe the holder, which PGlite cannot provide.
    it.skipIf(!isServerDB)(
      'skips instead of waiting when another batch holds the agent',
      async () => {
        await insertDocument('doc-held');

        await db.transaction(async (holder) => {
          await holder.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`agentSpaceMigration:${agentId}`})::bigint)`,
          );

          await expect(repository.migrateBatch(agentId)).resolves.toEqual({
            done: false,
            migrated: 0,
            skipped: true,
          });
        });
      },
    );
  });
});
