// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents } from '../../schemas/agent';
import { chatGroups } from '../../schemas/chatGroup';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../schemas/file';
import { messages } from '../../schemas/message';
import { sessions } from '../../schemas/session';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
} from '../../schemas/userMemories';
import { workspaces } from '../../schemas/workspace';
import type { LobeChatDatabase } from '../../type';
import {
  describeFtsSearchProductBehavior,
  otherUserId,
  userId,
} from './__tests__/productSearchBehavior';
import { FtsSearchRepo } from './index';
import { PgLikeFtsSearchBackend } from './pgLike';

const serverDB: LobeChatDatabase = await getTestDB();

const createRepo = (
  db: LobeChatDatabase,
  scopedUserId: string,
  workspaceId?: string,
  callerAgentVisibility?: 'private' | 'public' | null,
) =>
  new FtsSearchRepo(db, scopedUserId, workspaceId, callerAgentVisibility, {
    backend: new PgLikeFtsSearchBackend(db, {
      callerAgentVisibility,
      userId: scopedUserId,
      workspaceId,
    }),
    ftsSearchCandidateEnabled: true,
  });

/**
 * pg_like needs no PostgreSQL extension, so the full product-search behaviour
 * suite runs under PGlite instead of the ParadeDB container used by pg_search.
 */
describe('FtsSearchRepo (pg_like)', () => {
  describeFtsSearchProductBehavior({ createRepo, db: serverDB });

  describe('LIKE wildcard escaping', () => {
    beforeEach(async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await serverDB.insert(agents).values([
        { title: 'Discount 100% agent', userId },
        { title: 'snake_case agent', userId },
        { title: 'Plain agent', userId },
        { title: 'Backslash \\ agent', userId },
      ]);
    });

    it('treats % and _ in the query literally', async () => {
      const repo = createRepo(serverDB, userId);

      const percent = await repo.search({ query: '100%', type: 'agent' });
      expect(percent.map((item) => item.title)).toEqual(['Discount 100% agent']);

      const underscore = await repo.search({ query: 'snake_case', type: 'agent' });
      expect(underscore.map((item) => item.title)).toEqual(['snake_case agent']);

      const lonelyUnderscore = await repo.search({ query: '_', type: 'agent' });
      expect(lonelyUnderscore.map((item) => item.title)).toEqual(['snake_case agent']);
    });

    it('treats a backslash in the query literally', async () => {
      const repo = createRepo(serverDB, userId);

      const results = await repo.search({ query: '\\', type: 'agent' });
      expect(results.map((item) => item.title)).toEqual(['Backslash \\ agent']);
    });

    it('requires every whitespace-separated term to match within one field', async () => {
      const repo = createRepo(serverDB, userId);

      const results = await repo.search({ query: 'agent plain', type: 'agent' });
      expect(results.map((item) => item.title)).toEqual(['Plain agent']);
    });
  });

  describe('restricted knowledge base exclusions', () => {
    const restrictedKb = 'pg-like-restricted-kb';
    const allowedKb = 'pg-like-allowed-kb';

    beforeEach(async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await serverDB.insert(knowledgeBases).values([
        // whole-name match: outranks the allowed knowledge base
        { id: restrictedKb, name: 'Kubernetes', userId },
        { id: allowedKb, name: 'Kubernetes docs', userId },
      ]);
      await serverDB.insert(files).values([
        {
          fileType: 'application/pdf',
          id: 'pg-like-restricted-file',
          name: 'kubernetes',
          size: 1,
          url: 's3://bucket/restricted.pdf',
          userId,
        },
        {
          fileType: 'application/pdf',
          id: 'pg-like-allowed-file',
          name: 'kubernetes notes',
          size: 1,
          url: 's3://bucket/allowed.pdf',
          userId,
        },
      ]);
      await serverDB
        .insert(knowledgeBaseFiles)
        .values([{ fileId: 'pg-like-restricted-file', knowledgeBaseId: restrictedKb, userId }]);
      await serverDB.insert(documents).values([
        {
          content: '',
          fileType: 'custom/folder',
          filename: 'restricted folder',
          id: 'pg-like-restricted-folder',
          knowledgeBaseId: restrictedKb,
          source: 'internal://folder/restricted',
          sourceType: 'api',
          title: 'Kubernetes',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
        {
          content: '',
          fileType: 'custom/folder',
          filename: 'allowed folder',
          id: 'pg-like-allowed-folder',
          source: 'internal://folder/allowed',
          sourceType: 'api',
          title: 'Kubernetes runbooks',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
        {
          content: 'restricted page',
          fileType: 'custom/document',
          filename: 'restricted page',
          id: 'pg-like-restricted-page',
          knowledgeBaseId: restrictedKb,
          source: 'internal://page/restricted',
          sourceType: 'api',
          title: 'Kubernetes',
          totalCharCount: 15,
          totalLineCount: 1,
          userId,
        },
        {
          content: 'page bound to a restricted file',
          fileId: 'pg-like-restricted-file',
          fileType: 'custom/document',
          filename: 'restricted file page',
          id: 'pg-like-restricted-file-page',
          source: 'internal://page/restricted-file',
          sourceType: 'api',
          title: 'Kubernetes',
          totalCharCount: 30,
          totalLineCount: 1,
          userId,
        },
        {
          content: 'allowed page',
          fileType: 'custom/document',
          filename: 'allowed page',
          id: 'pg-like-allowed-page',
          source: 'internal://page/allowed',
          sourceType: 'api',
          title: 'Kubernetes upgrade page',
          totalCharCount: 12,
          totalLineCount: 1,
          userId,
        },
      ]);
    });

    it.each([
      ['knowledgeBase', 'Kubernetes docs'],
      ['file', 'kubernetes notes'],
      ['folder', 'Kubernetes runbooks'],
      ['page', 'Kubernetes upgrade page'],
    ] as const)(
      'does not let a restricted %s hit consume the only slot',
      async (type, expectedTitle) => {
        const repo = createRepo(serverDB, userId);

        const results = await repo.search({
          excludeKnowledgeBaseIds: [restrictedKb],
          limitPerType: 1,
          query: 'kubernetes',
          type,
        });

        expect(results.map((item) => item.title)).toEqual([expectedTitle]);
      },
    );
  });

  describe('candidates mode', () => {
    const workspaceId = 'pg-like-workspace';
    const now = new Date();

    beforeEach(async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'pg_like workspace',
        primaryOwnerId: userId,
        slug: 'pg-like-workspace',
      });
    });

    it('returns scoped agent ids ordered by score with an empty item list', async () => {
      const [exact, prefix, contains, description] = await serverDB
        .insert(agents)
        .values([
          { title: 'Kubernetes', userId },
          { title: 'Kubernetes operator', userId },
          { title: 'Managed Kubernetes cluster', userId },
          { description: 'Talks about kubernetes', title: 'Infra helper', userId },
          { title: 'Kubernetes other user', userId: otherUserId },
          { title: 'Kubernetes workspace agent', userId, workspaceId },
        ])
        .returning({ id: agents.id });

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id)).toEqual([
        exact.id,
        prefix.id,
        contains.id,
        description.id,
      ]);
      expect(response.total).toBe(4);
      expect(response.candidates.every((candidate) => (candidate.score ?? 0) > 0)).toBe(true);
    });

    it('scopes workspace requests to the workspace', async () => {
      const [, workspaceAgent] = await serverDB
        .insert(agents)
        .values([
          { title: 'Kubernetes personal', userId },
          { title: 'Kubernetes workspace', userId, workspaceId },
        ])
        .returning({ id: agents.id });

      const repo = createRepo(serverDB, userId, workspaceId);
      const response = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id)).toEqual([workspaceAgent.id]);
    });

    it('honours Elasticsearch-style field names with boost suffixes', async () => {
      const [titled, described] = await serverDB
        .insert(agents)
        .values([
          { description: 'nothing here', title: 'Kubernetes', userId },
          { description: 'kubernetes in description', title: 'Other', userId },
        ])
        .returning({ id: agents.id });

      const repo = createRepo(serverDB, userId);

      const titleOnly = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { fields: ['title^5'], text: 'kubernetes' },
      });
      expect(titleOnly.candidates.map((candidate) => candidate.id)).toEqual([titled.id]);

      const both = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { fields: ['title^5', 'description^2'], text: 'kubernetes' },
      });
      expect(both.candidates.map((candidate) => candidate.id).sort()).toEqual(
        [titled.id, described.id].sort(),
      );
    });

    it('applies memory category, type, status, and tag filters', async () => {
      const [project, personal] = await serverDB
        .insert(userMemories)
        .values([
          {
            lastAccessedAt: now,
            memoryCategory: 'project',
            memoryType: 'workflow',
            status: 'active',
            tags: ['typescript', 'search'],
            title: 'Search rollout plan',
            userId,
          },
          {
            lastAccessedAt: now,
            memoryCategory: 'personal',
            memoryType: 'workflow',
            status: 'active',
            tags: ['typescript'],
            title: 'Search hobby notes',
            userId,
          },
          {
            lastAccessedAt: now,
            memoryCategory: 'project',
            title: 'Search other user',
            userId: otherUserId,
          },
        ])
        .returning({ id: userMemories.id });

      const repo = createRepo(serverDB, userId);

      const byCategory = await repo.ftsSearchCandidates({
        entity: 'userMemories',
        filters: { memoryCategories: ['project'] },
        pagination: {},
        query: { text: 'search' },
      });
      expect(byCategory.candidates.map((candidate) => candidate.id)).toEqual([project.id]);

      const allTags = await repo.ftsSearchCandidates({
        entity: 'userMemories',
        filters: { memoryTagMatch: 'all', memoryTags: ['typescript', 'search'] },
        pagination: {},
        query: { text: 'search' },
      });
      expect(allTags.candidates.map((candidate) => candidate.id)).toEqual([project.id]);

      const anyTag = await repo.ftsSearchCandidates({
        entity: 'userMemories',
        filters: { memoryTagMatch: 'any', memoryTags: ['typescript'] },
        pagination: {},
        query: { text: 'search' },
      });
      expect(anyTag.candidates.map((candidate) => candidate.id).sort()).toEqual(
        [project.id, personal.id].sort(),
      );
    });

    it('requires every tag in all mode across layer tags, parent tags, or an untagged parent', async () => {
      const [taggedParent, untaggedParent, otherParent] = await serverDB
        .insert(userMemories)
        .values([
          { lastAccessedAt: now, tags: ['project'], title: 'Kubernetes rollout', userId },
          { lastAccessedAt: now, title: 'Kubernetes notes', userId },
          { lastAccessedAt: now, tags: ['personal'], title: 'Kubernetes hobby', userId },
        ])
        .returning({ id: userMemories.id });
      const [split, ownOnly, mismatch, untagged] = await serverDB
        .insert(userMemoriesActivities)
        .values([
          // typescript on the layer, project on the parent: every tag is present
          {
            narrative: 'Split tags',
            tags: ['typescript'],
            type: 'event',
            userId,
            userMemoryId: taggedParent.id,
          },
          // an untagged parent contributes nothing: only one required tag present
          {
            narrative: 'Own only',
            tags: ['typescript'],
            type: 'event',
            userId,
            userMemoryId: untaggedParent.id,
          },
          // parent carries tags but not the required one
          {
            narrative: 'Mismatch',
            tags: ['typescript'],
            type: 'event',
            userId,
            userMemoryId: otherParent.id,
          },
          // neither the layer nor the tagged parent carries `typescript`
          {
            narrative: 'Untagged layer',
            type: 'event',
            userId,
            userMemoryId: taggedParent.id,
          },
        ])
        .returning({ id: userMemoriesActivities.id });

      const repo = createRepo(serverDB, userId);

      const all = await repo.ftsSearchCandidates({
        entity: 'memoryActivities',
        filters: { memoryTagMatch: 'all', memoryTags: ['typescript', 'project'] },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(all.candidates.map((candidate) => candidate.id)).toEqual([split.id]);
      expect(all.candidates.map((candidate) => candidate.id)).not.toContain(ownOnly.id);

      const any = await repo.ftsSearchCandidates({
        entity: 'memoryActivities',
        filters: { memoryTagMatch: 'any', memoryTags: ['project'] },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(any.candidates.map((candidate) => candidate.id).sort()).toEqual(
        [split.id, untagged.id].sort(),
      );
      expect(any.candidates.map((candidate) => candidate.id)).not.toContain(mismatch.id);
      expect(any.candidates.map((candidate) => candidate.id)).not.toContain(ownOnly.id);
    });

    it('applies the memory time range before the candidate limit', async () => {
      const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));
      const [, inRange] = await serverDB
        .insert(userMemories)
        .values([
          // stronger match (whole-field) but outside the range
          { capturedAt: day(0), lastAccessedAt: now, title: 'Kubernetes', userId },
          { capturedAt: day(5), lastAccessedAt: now, title: 'Kubernetes cluster notes', userId },
          { capturedAt: day(9), lastAccessedAt: now, title: 'Kubernetes upgrade notes', userId },
        ])
        .returning({ id: userMemories.id });

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'userMemories',
        filters: { memoryTimeRange: { end: day(7), start: day(3) } },
        pagination: { limit: 1 },
        query: { text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id)).toEqual([inRange.id]);
    });

    it('applies an activity time range on the requested field', async () => {
      const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));
      const [early, late] = await serverDB
        .insert(userMemoriesActivities)
        .values([
          { narrative: 'Kubernetes early', startsAt: day(1), type: 'event', userId },
          { narrative: 'Kubernetes late', startsAt: day(8), type: 'event', userId },
        ])
        .returning({ id: userMemoriesActivities.id });

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'memoryActivities',
        filters: { memoryTimeRange: { field: 'startsAt', start: day(5) } },
        pagination: {},
        query: { text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id)).toEqual([late.id]);
      expect(response.candidates.map((candidate) => candidate.id)).not.toContain(early.id);
    });

    it('applies topic scope to topics and messages before the candidate limit', async () => {
      const [agentA, agentB] = await serverDB
        .insert(agents)
        .values([
          { title: 'Agent A', userId },
          { title: 'Agent B', userId },
        ])
        .returning({ id: agents.id });
      const [group] = await serverDB
        .insert(chatGroups)
        .values([{ title: 'Group', userId }])
        .returning({ id: chatGroups.id });
      const [session] = await serverDB
        .insert(sessions)
        .values([{ userId }])
        .returning({ id: sessions.id });
      const [topicA, topicB, topicGroup, topicSession] = await serverDB
        .insert(topics)
        .values([
          { agentId: agentA.id, title: 'Kubernetes topic A', userId },
          { agentId: agentB.id, title: 'Kubernetes topic B', userId },
          { groupId: group.id, title: 'Kubernetes topic group', userId },
          { sessionId: session.id, title: 'Kubernetes topic session', userId },
        ])
        .returning({ id: topics.id });
      const [messageA, messageB, messageLegacy] = await serverDB
        .insert(messages)
        .values([
          { agentId: agentA.id, content: 'Kubernetes message A', role: 'user', userId },
          { agentId: agentB.id, content: 'Kubernetes message B', role: 'user', userId },
          { content: 'Kubernetes message legacy', role: 'user', topicId: topicA.id, userId },
        ])
        .returning({ id: messages.id });

      const repo = createRepo(serverDB, userId);
      const ids = (response: { candidates: { id: string }[] }) =>
        response.candidates.map((candidate) => candidate.id).sort();

      const topicsByAgent = await repo.ftsSearchCandidates({
        entity: 'topics',
        filters: { topicScope: { agentId: agentA.id } },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(ids(topicsByAgent)).toEqual([topicA.id]);

      const topicsByGroup = await repo.ftsSearchCandidates({
        entity: 'topics',
        filters: { topicScope: { groupId: group.id } },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(ids(topicsByGroup)).toEqual([topicGroup.id]);

      const topicsByContainer = await repo.ftsSearchCandidates({
        entity: 'topics',
        filters: { topicScope: { containerId: session.id } },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(ids(topicsByContainer)).toEqual([topicSession.id]);
      expect(ids(topicsByContainer)).not.toContain(topicB.id);

      // Topic-bound messages may carry no agent id; they survive scope pruning so
      // the consumer can resolve their parent topic.
      const messagesByAgent = await repo.ftsSearchCandidates({
        entity: 'messages',
        filters: { topicScope: { agentId: agentA.id } },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(ids(messagesByAgent)).toEqual([messageA.id, messageLegacy.id].sort());

      const messagesByAgentFilter = await repo.ftsSearchCandidates({
        entity: 'messages',
        filters: { agentId: agentB.id },
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(ids(messagesByAgentFilter)).toEqual([messageB.id]);
    });

    it('matches memory layers through their parent memory text', async () => {
      const [parent] = await serverDB
        .insert(userMemories)
        .values([
          { lastAccessedAt: now, memoryCategory: 'project', title: 'Kubernetes migration', userId },
        ])
        .returning({ id: userMemories.id });
      const [activity, unrelated] = await serverDB
        .insert(userMemoriesActivities)
        .values([
          { narrative: 'Ran the cutover', type: 'event', userId, userMemoryId: parent.id },
          { narrative: 'Unrelated activity', type: 'event', userId, userMemoryId: null },
        ])
        .returning({ id: userMemoriesActivities.id });

      const repo = createRepo(serverDB, userId);

      const viaParent = await repo.ftsSearchCandidates({
        entity: 'memoryActivities',
        filters: {},
        pagination: {},
        query: { text: 'kubernetes' },
      });
      expect(viaParent.candidates.map((candidate) => candidate.id)).toEqual([activity.id]);

      const viaOwnText = await repo.ftsSearchCandidates({
        entity: 'memoryActivities',
        filters: {},
        pagination: {},
        query: { text: 'unrelated' },
      });
      expect(viaOwnText.candidates.map((candidate) => candidate.id)).toEqual([unrelated.id]);
    });

    it('deduplicates memory contexts joined to several parent memories', async () => {
      const parents = await serverDB
        .insert(userMemories)
        .values([
          { lastAccessedAt: now, title: 'Kubernetes cluster', userId },
          { lastAccessedAt: now, title: 'Kubernetes upgrade', userId },
        ])
        .returning({ id: userMemories.id });
      const [context] = await serverDB
        .insert(userMemoriesContexts)
        .values([
          {
            title: 'Platform work',
            userId,
            userMemoryIds: parents.map((parent) => parent.id),
          },
        ])
        .returning({ id: userMemoriesContexts.id });

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'memoryContexts',
        filters: {},
        pagination: {},
        query: { fields: ['parent_text', 'title'], text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id)).toEqual([context.id]);
      expect(response.total).toBe(1);
    });

    it('collapses multi-parent contexts before applying the candidate limit', async () => {
      const parents = await serverDB
        .insert(userMemories)
        .values(
          Array.from({ length: 8 }, (_, index) => ({
            lastAccessedAt: now,
            title: `Kubernetes parent ${index}`,
            userId,
          })),
        )
        .returning({ id: userMemories.id });
      const [heavy, light] = await serverDB
        .insert(userMemoriesContexts)
        .values([
          { title: 'Heavily linked', userId, userMemoryIds: parents.map((parent) => parent.id) },
          { title: 'Lightly linked', userId, userMemoryIds: [parents[0].id] },
        ])
        .returning({ id: userMemoriesContexts.id });

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'memoryContexts',
        filters: {},
        // pool of 4 rows: without grouping, the heavy context's 8 joined rows fill it
        pagination: { limit: 1 },
        query: { fields: ['parent_text', 'title'], text: 'kubernetes' },
      });

      expect(response.candidates.map((candidate) => candidate.id).sort()).toEqual(
        [heavy.id, light.id].sort(),
      );
      expect(response.total).toBe(2);
    });

    it('over-fetches bounded requests so hydration can fill the page', async () => {
      await serverDB
        .insert(agents)
        .values(
          Array.from({ length: 10 }, (_, index) => ({ title: `Kubernetes ${index}`, userId })),
        );

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: { limit: 2 },
        query: { text: 'kubernetes' },
      });

      expect(response.candidates).toHaveLength(8);
    });

    it('returns every match when the request is unbounded', async () => {
      await serverDB
        .insert(agents)
        .values(
          Array.from({ length: 10 }, (_, index) => ({ title: `Kubernetes ${index}`, userId })),
        );

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { text: 'kubernetes' },
      });

      expect(response.candidates).toHaveLength(10);
      expect(response.total).toBe(10);
    });

    it('serves file, knowledge base, and document candidates with their exclusions', async () => {
      const restrictedKb = 'pg-like-cand-restricted-kb';
      const allowedKb = 'pg-like-cand-allowed-kb';
      await serverDB.insert(knowledgeBases).values([
        { id: restrictedKb, name: 'Kubernetes restricted', userId },
        { id: allowedKb, name: 'Kubernetes allowed', userId },
      ]);
      await serverDB.insert(files).values([
        {
          fileType: 'application/pdf',
          id: 'cand-restricted-file',
          name: 'kubernetes restricted',
          size: 1,
          url: 's3://bucket/r.pdf',
          userId,
        },
        {
          fileType: 'application/pdf',
          id: 'cand-allowed-file',
          name: 'kubernetes allowed',
          size: 1,
          url: 's3://bucket/a.pdf',
          userId,
        },
        {
          fileType: 'custom/document',
          id: 'cand-page-file',
          name: 'kubernetes page backing file',
          size: 1,
          url: 's3://bucket/p',
          userId,
        },
      ]);
      await serverDB.insert(knowledgeBaseFiles).values([
        { fileId: 'cand-restricted-file', knowledgeBaseId: restrictedKb, userId },
        { fileId: 'cand-allowed-file', knowledgeBaseId: allowedKb, userId },
      ]);
      const document = (
        id: string,
        fileType: string,
        extra: Partial<typeof documents.$inferInsert> = {},
      ) => ({
        content: 'kubernetes body',
        fileType,
        filename: id,
        id,
        source: `internal://${id}`,
        sourceType: 'api' as const,
        title: `Kubernetes ${id}`,
        totalCharCount: 15,
        totalLineCount: 1,
        userId,
        ...extra,
      });
      await serverDB.insert(documents).values([
        document('cand-folder', 'custom/folder'),
        document('cand-folder-restricted', 'custom/folder', { knowledgeBaseId: restrictedKb }),
        document('cand-page', 'custom/document'),
        document('cand-page-restricted', 'custom/document', { knowledgeBaseId: restrictedKb }),
        document('cand-page-file-restricted', 'custom/document', {
          fileId: 'cand-restricted-file',
        }),
        document('cand-kb-doc-inline', 'application/pdf', { knowledgeBaseId: allowedKb }),
        document('cand-kb-doc-file', 'application/pdf', { fileId: 'cand-allowed-file' }),
      ]);

      const repo = createRepo(serverDB, userId);
      const ids = async (
        entity: 'documents' | 'files' | 'knowledgeBases',
        filters: Record<string, unknown>,
      ) => {
        const response = await repo.ftsSearchCandidates({
          entity,
          filters,
          pagination: {},
          query: { text: 'kubernetes' },
        });
        return response.candidates.map((candidate) => candidate.id).sort();
      };

      expect(await ids('files', {})).toEqual(['cand-allowed-file', 'cand-restricted-file']);
      expect(await ids('files', { excludeKnowledgeBaseIds: [restrictedKb] })).toEqual([
        'cand-allowed-file',
      ]);

      expect(await ids('knowledgeBases', { excludeKnowledgeBaseIds: [restrictedKb] })).toEqual([
        allowedKb,
      ]);

      expect(await ids('documents', { documentKind: 'folder' })).toEqual([
        'cand-folder',
        'cand-folder-restricted',
      ]);
      expect(
        await ids('documents', {
          documentKind: 'folder',
          excludeKnowledgeBaseIds: [restrictedKb],
        }),
      ).toEqual(['cand-folder']);
      expect(
        await ids('documents', {
          documentKind: 'page',
          excludeKnowledgeBaseIds: [restrictedKb],
        }),
      ).toEqual(['cand-page']);
      expect(
        await ids('documents', {
          documentKind: 'knowledgeBaseDocument',
          knowledgeBaseIds: [allowedKb],
        }),
      ).toEqual(['cand-kb-doc-file', 'cand-kb-doc-inline']);

      await expect(
        repo.ftsSearchCandidates({
          entity: 'documents',
          filters: {},
          pagination: {},
          query: { text: 'kubernetes' },
        }),
      ).rejects.toThrow('Candidate search provider failed');
    });

    it('returns nothing for a blank query', async () => {
      await serverDB.insert(agents).values([{ title: 'Kubernetes', userId }]);

      const repo = createRepo(serverDB, userId);
      const response = await repo.ftsSearchCandidates({
        entity: 'agents',
        filters: {},
        pagination: {},
        query: { text: '   ' },
      });

      expect(response).toEqual({ candidates: [], total: 0 });
    });
  });
});
