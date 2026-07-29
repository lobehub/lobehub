// @vitest-environment node
import { LayersEnum, RelationshipEnum, UserMemoryContextObjectType } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';
import type { LayerBaseMemorySignals } from '../query';
import { scoreHybridCandidates } from '../query';

const userId = 'memory-query-ext-user';
const otherUserId = 'memory-query-ext-other-user';

const serverDB: LobeChatDatabase = await getTestDB();

let memoryModel: UserMemoryModel;

/**
 * Direct access to the private query model so we can exercise the semantic
 * search SQL in isolation (the public `searchMemory` always also fires the
 * BM25 lexical query, which PGlite cannot run because it lacks pg_search).
 */
const getQueryModel = () =>
  Reflect.get(memoryModel, 'queryModel') as {
    searchActivitiesSemantic: (
      embedding: number[],
      limit: number,
      params: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>;
    searchContextsSemantic: (
      embedding: number[],
      limit: number,
      params: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>;
    searchExperiencesSemantic: (
      embedding: number[],
      limit: number,
      params: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>;
    searchIdentitiesSemantic: (
      embedding: number[],
      limit: number,
      params: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>;
    searchPreferencesSemantic: (
      embedding: number[],
      limit: number,
      params: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>;
  };

const vec = (seed: number) => Array.from({ length: 1024 }, (_, index) => (index === 0 ? seed : 0));

beforeEach(async () => {
  await serverDB.delete(userMemoriesActivities);
  await serverDB.delete(userMemoriesContexts);
  await serverDB.delete(userMemoriesExperiences);
  await serverDB.delete(userMemoriesIdentities);
  await serverDB.delete(userMemoriesPreferences);
  await serverDB.delete(userMemories);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  memoryModel = new UserMemoryModel(serverDB, userId);
});

const createActivityPair = async (opts: {
  capturedAt?: Date;
  memoryCategory?: string;
  memoryTags?: string[];
  narrative?: string;
  narrativeVector?: number[];
  ownerId?: string;
  status?: string;
  tags?: string[];
  title?: string;
  type?: string;
}) => {
  const owner = opts.ownerId ?? userId;
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt: opts.capturedAt,
      details: 'activity details',
      lastAccessedAt: new Date(),
      memoryCategory: opts.memoryCategory,
      memoryLayer: 'activity',
      memoryType: 'activity',
      summary: 'activity summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Activity memory',
      userId: owner,
    })
    .returning();

  const [activity] = await serverDB
    .insert(userMemoriesActivities)
    .values({
      capturedAt: opts.capturedAt,
      narrative: opts.narrative ?? 'did a thing',
      narrativeVector: opts.narrativeVector,
      status: opts.status ?? 'completed',
      tags: opts.tags,
      type: opts.type ?? 'task',
      userId: owner,
      userMemoryId: memory.id,
    } as typeof userMemoriesActivities.$inferInsert)
    .returning();

  return { activity, memory };
};

const createContextPair = async (opts: {
  currentStatus?: string;
  description?: string;
  descriptionVector?: number[];
  memoryCategory?: string;
  memoryTags?: string[];
  tags?: string[];
  title?: string;
  type?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'context details',
      lastAccessedAt: new Date(),
      memoryCategory: opts.memoryCategory,
      memoryLayer: 'context',
      memoryType: 'context',
      summary: 'context summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Context memory',
      userId,
    })
    .returning();

  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      associatedObjects: [{ name: 'Linear', type: UserMemoryContextObjectType.Application }],
      currentStatus: opts.currentStatus,
      description: opts.description ?? 'A context description',
      descriptionVector: opts.descriptionVector,
      tags: opts.tags,
      title: opts.title ?? 'Atlas context',
      type: opts.type ?? 'project',
      userId,
      userMemoryIds: [memory.id],
    } as typeof userMemoriesContexts.$inferInsert)
    .returning();

  return { context, memory };
};

const createExperiencePair = async (opts: {
  capturedAt?: Date;
  memoryCategory?: string;
  memoryTags?: string[];
  situation?: string;
  situationVector?: number[];
  tags?: string[];
  title?: string;
  type?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt: opts.capturedAt,
      details: 'experience details',
      lastAccessedAt: new Date(),
      memoryCategory: opts.memoryCategory,
      memoryLayer: 'experience',
      memoryType: 'experience',
      summary: 'experience summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Experience memory',
      userId,
    })
    .returning();

  const [experience] = await serverDB
    .insert(userMemoriesExperiences)
    .values({
      capturedAt: opts.capturedAt,
      situation: opts.situation ?? 'A tricky migration situation',
      situationVector: opts.situationVector,
      tags: opts.tags,
      type: opts.type ?? 'lesson',
      userId,
      userMemoryId: memory.id,
    } as typeof userMemoriesExperiences.$inferInsert)
    .returning();

  return { experience, memory };
};

const createPreferencePair = async (opts: {
  conclusionDirectives?: string;
  conclusionDirectivesVector?: number[];
  memoryCategory?: string;
  memoryTags?: string[];
  tags?: string[];
  title?: string;
  type?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'preference details',
      lastAccessedAt: new Date(),
      memoryCategory: opts.memoryCategory,
      memoryLayer: 'preference',
      memoryType: 'preference',
      summary: 'preference summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Preference memory',
      userId,
    })
    .returning();

  const [preference] = await serverDB
    .insert(userMemoriesPreferences)
    .values({
      conclusionDirectives: opts.conclusionDirectives ?? 'Prefer typed APIs',
      conclusionDirectivesVector: opts.conclusionDirectivesVector,
      suggestions: 'Add more integration tests',
      tags: opts.tags,
      type: opts.type ?? 'coding-style',
      userId,
      userMemoryId: memory.id,
    } as typeof userMemoriesPreferences.$inferInsert)
    .returning();

  return { memory, preference };
};

const createIdentityPair = async (opts: {
  description?: string;
  descriptionVector?: number[];
  episodicDate?: Date;
  memoryCategory?: string;
  memoryTags?: string[];
  relationship?: RelationshipEnum;
  role?: string;
  tags?: string[];
  title?: string;
  type?: 'demographic' | 'personal' | 'professional';
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'identity details',
      lastAccessedAt: new Date(),
      memoryCategory: opts.memoryCategory,
      memoryLayer: 'identity',
      memoryType: 'identity',
      summary: 'identity summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Identity memory',
      userId,
    })
    .returning();

  const [identity] = await serverDB
    .insert(userMemoriesIdentities)
    .values({
      description: opts.description ?? 'Identity description',
      descriptionVector: opts.descriptionVector,
      episodicDate: opts.episodicDate,
      relationship: opts.relationship ?? RelationshipEnum.Self,
      role: opts.role ?? 'Engineer',
      tags: opts.tags,
      type: opts.type ?? 'personal',
      userId,
      userMemoryId: memory.id,
    } as typeof userMemoriesIdentities.$inferInsert)
    .returning();

  return { identity, memory };
};

describe('queryTaxonomyOptions (extended)', () => {
  it('aggregates base-memory categories ordered by count then value', async () => {
    await createActivityPair({ memoryCategory: 'project', title: 'a' });
    await createActivityPair({ memoryCategory: 'project', title: 'b' });
    await createContextPair({ memoryCategory: 'personal' });

    const result = await memoryModel.queryTaxonomyOptions({ include: ['categories'], limit: 10 });

    expect(result.categories).toEqual([
      { count: 2, layers: undefined, value: 'project' },
      { count: 1, layers: undefined, value: 'personal' },
    ]);
    expect(result.hasMore.categories).toBe(false);
  });

  it('filters categories by layer and reports hasMore when limit is hit', async () => {
    await createActivityPair({ memoryCategory: 'project' });
    await createContextPair({ memoryCategory: 'personal' });

    const result = await memoryModel.queryTaxonomyOptions({
      include: ['categories'],
      layers: [LayersEnum.Activity],
      limit: 1,
    });

    expect(result.categories).toEqual([{ count: 1, layers: undefined, value: 'project' }]);
    expect(result.hasMore.categories).toBe(true);
  });

  it('aggregates layer types merged across layers', async () => {
    await createActivityPair({ type: 'task' });
    await createContextPair({ type: 'project' });
    await createExperiencePair({ type: 'lesson' });
    await createPreferencePair({ type: 'coding-style' });
    await createIdentityPair({ type: 'personal' });

    const result = await memoryModel.queryTaxonomyOptions({ include: ['types'], limit: 10 });

    const values = result.types.map((row) => row.value).sort();
    expect(values).toEqual(['coding-style', 'lesson', 'personal', 'project', 'task']);
    const taskRow = result.types.find((row) => row.value === 'task');
    expect(taskRow?.layers).toContain(LayersEnum.Activity);
  });

  it('restricts layer types when layers filter is provided', async () => {
    await createActivityPair({ type: 'task' });
    await createContextPair({ type: 'project' });

    const result = await memoryModel.queryTaxonomyOptions({
      include: ['types'],
      layers: [LayersEnum.Context],
      limit: 10,
    });

    expect(result.types.map((row) => row.value)).toEqual(['project']);
  });

  it('aggregates statuses from activity status and context currentStatus', async () => {
    await createActivityPair({ status: 'completed' });
    await createActivityPair({ status: 'completed' });
    await createContextPair({ currentStatus: 'active' });

    const result = await memoryModel.queryTaxonomyOptions({ include: ['statuses'], limit: 10 });

    expect(result.statuses).toContainEqual({
      count: 2,
      layers: [LayersEnum.Activity],
      value: 'completed',
    });
    expect(result.statuses).toContainEqual({
      count: 1,
      layers: [LayersEnum.Context],
      value: 'active',
    });
  });

  it('aggregates identity relationships and roles', async () => {
    await createIdentityPair({ relationship: RelationshipEnum.Friend, role: 'Sponsor' });
    await createIdentityPair({ relationship: RelationshipEnum.Friend, role: 'Observer' });

    const relationships = await memoryModel.queryTaxonomyOptions({
      include: ['relationships'],
      limit: 10,
    });
    expect(relationships.relationships).toEqual([
      { count: 2, layers: [LayersEnum.Identity], value: RelationshipEnum.Friend },
    ]);

    const roles = await memoryModel.queryTaxonomyOptions({ include: ['roles'], limit: 10 });
    expect(roles.roles.map((row) => row.value).sort()).toEqual(['Observer', 'Sponsor']);
  });

  it('applies the q filter to identity relationship/role aggregation', async () => {
    await createIdentityPair({ role: 'Backend Engineer' });
    await createIdentityPair({ role: 'Product Manager' });

    const result = await memoryModel.queryTaxonomyOptions({
      include: ['roles'],
      limit: 10,
      q: 'engineer',
    });

    expect(result.roles.map((row) => row.value)).toEqual(['Backend Engineer']);
  });

  it('applies a timeRange filter to base-memory tag aggregation', async () => {
    await createActivityPair({
      capturedAt: new Date('2026-03-20T10:00:00.000Z'),
      memoryTags: ['recent'],
      tags: ['recent'],
    });
    await createActivityPair({
      capturedAt: new Date('2026-01-01T10:00:00.000Z'),
      memoryTags: ['old'],
      tags: ['old'],
    });

    const result = await memoryModel.queryTaxonomyOptions({
      include: ['tags'],
      limit: 10,
      timeRange: {
        end: new Date('2026-03-21T00:00:00.000Z'),
        field: 'capturedAt',
        start: new Date('2026-03-19T00:00:00.000Z'),
      },
    });

    expect(result.tags.map((row) => row.value)).toEqual(['recent']);
  });

  it('resolves to no rows when the timeRange field is unsupported by the source table', async () => {
    await createActivityPair({ memoryCategory: 'project' });

    const result = await memoryModel.queryTaxonomyOptions({
      include: ['categories'],
      limit: 10,
      timeRange: {
        // episodicDate is not part of the base-memory time field map
        field: 'episodicDate',
        start: new Date('2026-03-19T00:00:00.000Z'),
      },
    });

    expect(result.categories).toEqual([]);
  });

  it('returns the full default taxonomy result when include is omitted', async () => {
    await createActivityPair({ memoryCategory: 'project', tags: ['atlas'], type: 'task' });
    await createIdentityPair({ relationship: RelationshipEnum.Friend, role: 'Sponsor' });

    const result = await memoryModel.queryTaxonomyOptions();

    expect(result.categories.length).toBeGreaterThan(0);
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.types.length).toBeGreaterThan(0);
    expect(result.relationships.length).toBeGreaterThan(0);
    expect(result.roles.length).toBeGreaterThan(0);
  });

  it('returns empty buckets when include is an empty list', async () => {
    await createActivityPair({ memoryCategory: 'project' });

    const result = await memoryModel.queryTaxonomyOptions({ include: [], limit: 10 });

    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.types).toEqual([]);
    expect(result.statuses).toEqual([]);
  });

  it('only aggregates the current user memories (ownership isolation)', async () => {
    await createActivityPair({ memoryCategory: 'mine' });
    await createActivityPair({ memoryCategory: 'theirs', ownerId: otherUserId });

    const result = await memoryModel.queryTaxonomyOptions({ include: ['categories'], limit: 10 });

    expect(result.categories.map((row) => row.value)).toEqual(['mine']);
  });
});

describe('semantic search (non-BM25 vector paths)', () => {
  it('orders activities by cosine similarity to the query embedding', async () => {
    const { activity: near } = await createActivityPair({
      narrative: 'near match',
      narrativeVector: vec(1),
      title: 'near',
    });
    const { activity: far } = await createActivityPair({
      narrative: 'far match',
      narrativeVector: vec(-1),
      title: 'far',
    });

    const rows = await getQueryModel().searchActivitiesSemantic(vec(1), 5, {});

    expect(rows.map((row) => row.id)).toEqual([near.id, far.id]);
  });

  it('applies category/status/type/timeRange/tag filters to activity semantic search', async () => {
    const { activity: kept } = await createActivityPair({
      capturedAt: new Date('2026-03-20T10:00:00.000Z'),
      memoryCategory: 'project',
      memoryTags: ['atlas'],
      narrativeVector: vec(1),
      status: 'completed',
      tags: ['atlas'],
      type: 'task',
    });
    await createActivityPair({
      capturedAt: new Date('2026-01-01T10:00:00.000Z'),
      memoryCategory: 'personal',
      narrativeVector: vec(1),
      status: 'pending',
      type: 'note',
    });

    const rows = await getQueryModel().searchActivitiesSemantic(vec(1), 5, {
      categories: ['project'],
      labels: ['atlas'],
      status: ['completed'],
      timeRange: {
        end: new Date('2026-03-21T00:00:00.000Z'),
        field: 'capturedAt',
        start: new Date('2026-03-19T00:00:00.000Z'),
      },
      types: ['task'],
    });

    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it('dedupes and orders contexts by cosine similarity', async () => {
    const { context: near } = await createContextPair({
      description: 'near context',
      descriptionVector: vec(1),
      title: 'near ctx',
    });
    const { context: far } = await createContextPair({
      description: 'far context',
      descriptionVector: vec(-1),
      title: 'far ctx',
    });

    const rows = await getQueryModel().searchContextsSemantic(vec(1), 5, {});

    expect(rows.map((row) => row.id)).toEqual([near.id, far.id]);
  });

  it('applies category and status filters to context semantic search', async () => {
    const { context: kept } = await createContextPair({
      currentStatus: 'active',
      description: 'kept context',
      descriptionVector: vec(1),
      memoryCategory: 'project',
    });
    await createContextPair({
      currentStatus: 'archived',
      description: 'dropped context',
      descriptionVector: vec(1),
      memoryCategory: 'personal',
    });

    const rows = await getQueryModel().searchContextsSemantic(vec(1), 5, {
      categories: ['project'],
      status: ['active'],
    });

    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it('orders experiences by cosine similarity to the query embedding', async () => {
    const { experience: near } = await createExperiencePair({
      situation: 'near experience',
      situationVector: vec(1),
      title: 'near exp',
    });
    const { experience: far } = await createExperiencePair({
      situation: 'far experience',
      situationVector: vec(-1),
      title: 'far exp',
    });

    const rows = await getQueryModel().searchExperiencesSemantic(vec(1), 5, {});

    expect(rows.map((row) => row.id)).toEqual([near.id, far.id]);
  });

  it('applies category filter to experience semantic search', async () => {
    const { experience: kept } = await createExperiencePair({
      memoryCategory: 'project',
      situation: 'kept experience',
      situationVector: vec(1),
    });
    await createExperiencePair({
      memoryCategory: 'personal',
      situation: 'dropped experience',
      situationVector: vec(1),
    });

    const rows = await getQueryModel().searchExperiencesSemantic(vec(1), 5, {
      categories: ['project'],
    });

    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it('orders preferences by cosine similarity and respects type/category filter', async () => {
    const { preference: kept } = await createPreferencePair({
      conclusionDirectives: 'typed apis',
      conclusionDirectivesVector: vec(1),
      memoryCategory: 'project',
      type: 'coding-style',
    });
    await createPreferencePair({
      conclusionDirectives: 'concise notes',
      conclusionDirectivesVector: vec(1),
      memoryCategory: 'personal',
      type: 'communication-style',
    });

    const rows = await getQueryModel().searchPreferencesSemantic(vec(1), 5, {
      categories: ['project'],
      types: ['coding-style'],
    });

    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it('orders identities by cosine similarity and respects relationship/category filter', async () => {
    const { identity: kept } = await createIdentityPair({
      description: 'sponsor identity',
      descriptionVector: vec(1),
      memoryCategory: 'project',
      relationship: RelationshipEnum.Friend,
    });
    await createIdentityPair({
      description: 'self identity',
      descriptionVector: vec(1),
      memoryCategory: 'personal',
      relationship: RelationshipEnum.Self,
    });

    const rows = await getQueryModel().searchIdentitiesSemantic(vec(1), 5, {
      categories: ['project'],
      relationships: [RelationshipEnum.Friend],
    });

    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });
});

describe('lexical filter-only search (no BM25 query)', () => {
  it('filters activities by timeRange without running BM25', async () => {
    const { activity: kept } = await createActivityPair({
      capturedAt: new Date('2026-03-20T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'recent activity',
    });
    await createActivityPair({
      capturedAt: new Date('2026-01-01T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'old activity',
    });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      timeRange: {
        end: new Date('2026-03-21T00:00:00.000Z'),
        field: 'capturedAt',
        start: new Date('2026-03-19T00:00:00.000Z'),
      },
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters experiences by type and tags without running BM25', async () => {
    const { experience: kept } = await createExperiencePair({
      memoryTags: ['migration'],
      tags: ['migration'],
      title: 'migration lesson',
      type: 'lesson',
    });
    await createExperiencePair({
      memoryTags: ['other'],
      tags: ['other'],
      title: 'other note',
      type: 'note',
    });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Experience],
      tags: ['migration'],
      topK: { activities: 0, contexts: 0, experiences: 5, identities: 0, preferences: 0 },
      types: ['lesson'],
    });

    expect(result.experiences.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters contexts by category without running BM25', async () => {
    const { context: kept } = await createContextPair({
      memoryCategory: 'project',
      memoryTags: ['atlas'],
      tags: ['atlas'],
      title: 'project context',
    });
    await createContextPair({
      memoryCategory: 'personal',
      memoryTags: ['atlas'],
      tags: ['atlas'],
      title: 'personal context',
    });

    const result = await memoryModel.searchMemory({
      categories: ['project'],
      layers: [LayersEnum.Context],
      tags: ['atlas'],
      topK: { activities: 0, contexts: 5, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.contexts.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters preferences by category without running BM25', async () => {
    const { preference: kept } = await createPreferencePair({
      memoryCategory: 'project',
      memoryTags: ['typescript'],
      tags: ['typescript'],
    });
    await createPreferencePair({
      memoryCategory: 'personal',
      memoryTags: ['typescript'],
      tags: ['typescript'],
    });

    const result = await memoryModel.searchMemory({
      categories: ['project'],
      layers: [LayersEnum.Preference],
      tags: ['typescript'],
      topK: { activities: 0, contexts: 0, experiences: 0, identities: 0, preferences: 5 },
    });

    expect(result.preferences.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters identities by category and relationship without running BM25', async () => {
    const { identity: kept } = await createIdentityPair({
      memoryCategory: 'project',
      memoryTags: ['atlas'],
      relationship: RelationshipEnum.Friend,
      tags: ['atlas'],
    });
    await createIdentityPair({
      memoryCategory: 'personal',
      memoryTags: ['atlas'],
      relationship: RelationshipEnum.Self,
      tags: ['atlas'],
    });

    const result = await memoryModel.searchMemory({
      categories: ['project'],
      layers: [LayersEnum.Identity],
      relationships: [RelationshipEnum.Friend],
      tags: ['atlas'],
      topK: { activities: 0, contexts: 0, experiences: 0, identities: 5, preferences: 0 },
    });

    expect(result.identities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters activities by category without running BM25', async () => {
    const { activity: kept } = await createActivityPair({
      memoryCategory: 'project',
      memoryTags: ['atlas'],
      tags: ['atlas'],
      title: 'project activity',
    });
    await createActivityPair({
      memoryCategory: 'personal',
      memoryTags: ['atlas'],
      tags: ['atlas'],
      title: 'personal activity',
    });

    const result = await memoryModel.searchMemory({
      categories: ['project'],
      layers: [LayersEnum.Activity],
      tags: ['atlas'],
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('filters experiences by category without running BM25', async () => {
    const { experience: kept } = await createExperiencePair({
      memoryCategory: 'project',
      memoryTags: ['migration'],
      tags: ['migration'],
    });
    await createExperiencePair({
      memoryCategory: 'personal',
      memoryTags: ['migration'],
      tags: ['migration'],
    });

    const result = await memoryModel.searchMemory({
      categories: ['project'],
      layers: [LayersEnum.Experience],
      tags: ['migration'],
      topK: { activities: 0, contexts: 0, experiences: 5, identities: 0, preferences: 0 },
    });

    expect(result.experiences.map((item) => item.id)).toEqual([kept.id]);
  });

  it('supports a start-only timeRange filter', async () => {
    const { activity: kept } = await createActivityPair({
      capturedAt: new Date('2026-03-20T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'after start',
    });
    await createActivityPair({
      capturedAt: new Date('2026-01-01T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'before start',
    });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      tags: ['atlas'],
      timeRange: { field: 'capturedAt', start: new Date('2026-03-01T00:00:00.000Z') },
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('supports an end-only timeRange filter', async () => {
    await createActivityPair({
      capturedAt: new Date('2026-03-20T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'after end',
    });
    const { activity: kept } = await createActivityPair({
      capturedAt: new Date('2026-01-01T10:00:00.000Z'),
      tags: ['atlas'],
      title: 'before end',
    });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      tags: ['atlas'],
      timeRange: { end: new Date('2026-02-01T00:00:00.000Z'), field: 'capturedAt' },
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('runs the lexical path purely from a types filter (hasSearchFilters via types)', async () => {
    const { activity: kept } = await createActivityPair({ title: 'typed', type: 'task' });
    await createActivityPair({ title: 'untyped', type: 'note' });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
      types: ['task'],
    });

    expect(result.activities.map((item) => item.id)).toEqual([kept.id]);
  });

  it('returns empty layers when topK is zero across the board', async () => {
    await createActivityPair({ tags: ['atlas'] });

    const result = await memoryModel.searchMemory({
      tags: ['atlas'],
      topK: { activities: 0, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities).toEqual([]);
    expect(result.contexts).toEqual([]);
    expect(result.experiences).toEqual([]);
    expect(result.identities).toEqual([]);
    expect(result.preferences).toEqual([]);
  });

  it('skips both lexical and semantic retrieval when there are no queries and no filters', async () => {
    await createActivityPair({ tags: ['atlas'] });
    await createContextPair({ tags: ['atlas'] });
    await createExperiencePair({ tags: ['atlas'] });
    await createIdentityPair({ tags: ['atlas'] });
    await createPreferencePair({ tags: ['atlas'] });

    // every layer is requested with topK > 0 but no queries/filters, so both the
    // lexical and semantic candidate lists collapse to [] in every hybrid method.
    const result = await memoryModel.searchMemory({
      topK: { activities: 5, contexts: 5, experiences: 5, identities: 5, preferences: 5 },
    });

    expect(result.activities).toEqual([]);
    expect(result.contexts).toEqual([]);
    expect(result.experiences).toEqual([]);
    expect(result.identities).toEqual([]);
    expect(result.preferences).toEqual([]);
  });

  it('treats a timeRange with neither start nor end as no filter', async () => {
    await createActivityPair({ tags: ['atlas'], title: 'a' });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      tags: ['atlas'],
      // empty bounds -> buildTimeRangeCondition returns undefined, so only the tag filter applies
      timeRange: { field: 'capturedAt' },
      topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities).toHaveLength(1);
  });

  it('reports hasMore in layer meta when results exceed the per-layer limit', async () => {
    await createActivityPair({ tags: ['atlas'], title: 'one' });
    await createActivityPair({ tags: ['atlas'], title: 'two' });

    const result = await memoryModel.searchMemory({
      layers: [LayersEnum.Activity],
      tags: ['atlas'],
      topK: { activities: 1, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
    });

    expect(result.activities).toHaveLength(1);
    expect(result.meta.layers.activities.hasMore).toBe(true);
    expect(result.meta.layers.activities.total).toBe(2);
  });
});

describe('scoreHybridCandidates (edge cases)', () => {
  it('returns an empty list when there are no items', () => {
    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [],
      lexicalLists: [],
      queries: ['anything'],
      queryParams: { queries: ['anything'] },
      semanticLists: [],
    });

    expect(result).toEqual([]);
  });

  it('handles candidates without base signals and with non-string field values', () => {
    const item = {
      // numeric + object + array fields exercise extractSearchableTerms branches
      id: 'lonely',
      narrative: 'project atlas review',
      scoreImpact: 42,
      metadata: { nested: 'atlas detail' },
      tags: ['atlas'],
    };

    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [item],
      lexicalLists: [[item]],
      queries: ['atlas'],
      queryParams: { queries: ['atlas'] },
      semanticLists: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe('lonely');
    // no base signals and no other candidates -> no cluster boost
    expect(result[0].score.clusterBoost).toBe(0);
    expect(result[0].score.fuzzy).toBeGreaterThan(0);
  });

  it('uses the default temporal window when start and end collapse to the same instant', () => {
    const sameInstant = new Date('2026-03-20T10:00:00.000Z');
    const item = {
      capturedAt: new Date('2026-03-25T10:00:00.000Z'),
      id: 'temporal',
      narrative: 'review',
      tags: [],
    };

    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [item],
      lexicalLists: [[item]],
      queries: ['review'],
      queryParams: {
        queries: ['review'],
        timeRange: { end: sameInstant, field: 'capturedAt', start: sameInstant },
      },
      semanticLists: [],
    });

    // outside the window but scored against the default window -> bounded (0, 1)
    expect(result[0].score.temporal).toBeGreaterThan(0);
    expect(result[0].score.temporal).toBeLessThan(1);
  });

  it('handles a single-sided timeRange (start only) when scoring temporal distance', () => {
    const item = {
      capturedAt: new Date('2026-03-25T10:00:00.000Z'),
      id: 'single-sided',
      narrative: 'review',
      tags: [],
    };

    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [item],
      lexicalLists: [[item]],
      queries: ['review'],
      queryParams: {
        queries: ['review'],
        timeRange: { field: 'capturedAt', start: new Date('2026-03-20T10:00:00.000Z') },
      },
      semanticLists: [],
    });

    expect(result[0].score.temporal).toBeGreaterThanOrEqual(0);
    expect(result[0].score.temporal).toBeLessThanOrEqual(1);
  });

  it('does not boost candidates that share no temporal proximity with seeds', () => {
    const seedTime = new Date('2026-03-20T10:00:00.000Z').getTime();
    const baseSignals = new Map<string, LayerBaseMemorySignals>([
      [
        'seed',
        { categories: ['project'], memoryIds: ['m-seed'], tags: ['atlas'], times: [seedTime] },
      ],
      // far-future candidate has times, but distance is enormous
      [
        'far',
        {
          categories: ['project'],
          memoryIds: ['m-far'],
          tags: ['atlas'],
          times: [seedTime + 1000 * 60 * 60 * 24 * 365],
        },
      ],
    ]);
    const seed = {
      capturedAt: new Date(seedTime),
      id: 'seed',
      narrative: 'atlas',
      tags: ['atlas'],
    };
    const far = {
      capturedAt: new Date(seedTime + 1000 * 60 * 60 * 24 * 365),
      id: 'far',
      narrative: 'atlas',
      tags: ['atlas'],
    };

    const result = scoreHybridCandidates({
      baseSignals,
      items: [seed, far],
      lexicalLists: [[seed, far]],
      queries: ['atlas'],
      queryParams: { queries: ['atlas'] },
      semanticLists: [],
    });

    const farScore = result.find((entry) => entry.item.id === 'far')?.score;
    // temporal proximity collapses to ~0 across a one-year gap
    expect(farScore?.clusterBoost).toBeCloseTo(0, 5);
  });

  it('treats candidates and seeds with no time signals as infinitely distant', () => {
    const baseSignals = new Map<string, LayerBaseMemorySignals>([
      ['seed', { categories: ['project'], memoryIds: ['m-seed'], tags: ['atlas'], times: [] }],
      ['other', { categories: ['project'], memoryIds: ['m-other'], tags: ['atlas'], times: [] }],
    ]);
    // items carry no date fields at all, so candidateTimes resolves to empty
    const seed = { id: 'seed', narrative: 'atlas', tags: ['atlas'] };
    const other = { id: 'other', narrative: 'atlas', tags: ['atlas'] };

    const result = scoreHybridCandidates({
      baseSignals,
      items: [seed, other],
      lexicalLists: [[seed, other]],
      queries: ['atlas'],
      queryParams: { queries: ['atlas'] },
      semanticLists: [],
    });

    // no temporal proximity -> short-term association is zero -> no cluster boost,
    // but tag/category affinity still register
    const otherScore = result.find((entry) => entry.item.id === 'other')?.score;
    expect(otherScore?.clusterBoost).toBe(0);
    expect(otherScore?.tagAffinity).toBeGreaterThan(0);
  });

  it('coerces string and numeric date fields when collecting candidate times', () => {
    const start = new Date('2026-03-19T00:00:00.000Z');
    const end = new Date('2026-03-21T00:00:00.000Z');
    const item = {
      // string + numeric epoch date fields exercise the coerceDate string/number branch
      capturedAt: '2026-03-20T10:00:00.000Z',
      createdAt: new Date('2026-03-20T10:00:00.000Z').getTime(),
      id: 'coerced',
      narrative: 'atlas review',
      tags: ['atlas'],
    };

    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [item],
      lexicalLists: [[item]],
      queries: ['atlas'],
      queryParams: {
        queries: ['atlas'],
        timeRange: { end, field: 'capturedAt', start },
      },
      semanticLists: [],
    });

    // the coerced timestamps fall inside the time window -> full temporal score
    expect(result[0].score.temporal).toBe(1);
  });

  it('ignores non-date-like values when coercing candidate times', () => {
    const item = {
      // an object value is neither Date, string, nor number -> coerceDate returns null
      capturedAt: { not: 'a date' } as unknown as Date,
      id: 'bad-date',
      narrative: 'atlas review',
      tags: ['atlas'],
    };

    const result = scoreHybridCandidates({
      baseSignals: new Map<string, LayerBaseMemorySignals>(),
      items: [item],
      lexicalLists: [[item]],
      queries: ['atlas'],
      queryParams: {
        queries: ['atlas'],
        timeRange: {
          end: new Date('2026-03-21T00:00:00.000Z'),
          field: 'capturedAt',
          start: new Date('2026-03-19T00:00:00.000Z'),
        },
      },
      semanticLists: [],
    });

    // no usable timestamps -> temporal score is zero, but the candidate still ranks
    expect(result).toHaveLength(1);
    expect(result[0].score.temporal).toBe(0);
  });
});
