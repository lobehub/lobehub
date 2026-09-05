// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents } from '../../schemas/agent';
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
