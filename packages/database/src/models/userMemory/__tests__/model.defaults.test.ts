// @vitest-environment node
import { LayersEnum, MemorySourceType, MergeStrategyEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesContexts,
  userMemoriesIdentities,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryActivityModel } from '../activity';
import { UserMemoryContextModel } from '../context';
import { UserMemoryExperienceModel } from '../experience';
import { UserMemoryIdentityModel } from '../identity';
import { UserMemoryModel } from '../model';

const userId = 'memory-defaults-test-user';

const serverDB: LobeChatDatabase = await getTestDB();
let memoryModel: UserMemoryModel;

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  memoryModel = new UserMemoryModel(serverDB, userId);
});

// Memory rows cascade from the user row.
afterAll(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const BUILDER_METHODS = [
  'from',
  'groupBy',
  'innerJoin',
  'leftJoin',
  'limit',
  'offset',
  'onConflictDoNothing',
  'onConflictDoUpdate',
  'orderBy',
  'returning',
  'set',
  'values',
  'where',
] as const;

/** Chainable fake query builder: every builder method returns itself and awaiting it yields `rows`. */
const chain = (rows: unknown[]) => {
  const builder: any = Promise.resolve(rows);
  for (const method of BUILDER_METHODS) builder[method] = () => builder;

  return builder;
};

const ftsSource = (candidateIds: string[]) => ({
  ftsSearchCandidateEnabled: true,
  ftsSearchCandidates: vi.fn(async () => ({
    candidates: candidateIds.map((id, index) => ({ id, score: candidateIds.length - index })),
    total: candidateIds.length,
  })),
});

describe('UserMemoryModel static parsers - fallbacks', () => {
  it('wraps a JSON scalar association extra and drops a missing one', () => {
    expect(
      UserMemoryModel.parseAssociatedSubjects([
        { extra: '42', name: 'Scalar', type: 'person' },
        { extra: null, name: 'Bare', type: 'person' },
      ]),
    ).toEqual([
      { extra: { value: 42 }, name: 'Scalar', type: 'person' },
      { name: 'Bare', type: 'person' },
    ]);
  });

  it('returns an empty list when no subject survives parsing', () => {
    expect(UserMemoryModel.parseAssociatedSubjects([42, { name: 7 }])).toEqual([]);
  });

  it('skips non-object locations', () => {
    expect(
      UserMemoryModel.parseAssociatedLocations([null, 'Paris', { name: 'Tokyo' }] as any),
    ).toEqual([{ address: undefined, name: 'Tokyo', tags: undefined, type: undefined }]);
  });

  it('returns null for a whitespace-only date string', () => {
    expect(UserMemoryModel.parseDateFromString('   ')).toBeNull();
  });
});

describe('UserMemoryModel.extractSourceMetadata', () => {
  const extract = (metadata: unknown) => (memoryModel as any).extractSourceMetadata(metadata);

  it('ignores non-object metadata', () => {
    expect(extract('topic-1')).toEqual({});
  });

  it('reads string source fields and defaults the type to chat topics', () => {
    expect(extract({ sourceId: 'topic-1', sourceType: 'custom' })).toEqual({
      sourceId: 'topic-1',
      sourceType: 'custom',
    });
    expect(extract({ sourceId: 7, sourceType: 7 })).toEqual({
      sourceId: undefined,
      sourceType: MemorySourceType.ChatTopic,
    });
  });
});

describe('UserMemoryModel create defaults', () => {
  it('create() inserts a bare base memory with null optional columns', async () => {
    const memory = await memoryModel.create({ memoryLayer: LayersEnum.Context } as any);

    expect(memory).toMatchObject({
      details: null,
      memoryLayer: LayersEnum.Context,
      memoryType: null,
      metadata: null,
      status: null,
      summary: null,
      tags: null,
      title: null,
      userId,
    });
  });

  it('createContextMemory() fills every omitted context field', async () => {
    const { context, memory } = await memoryModel.createContextMemory({
      context: {},
      memoryLayer: LayersEnum.Context,
    } as any);

    expect(memory.tags).toBeNull();
    expect(context).toMatchObject({
      associatedObjects: [],
      associatedSubjects: [],
      description: null,
      tags: [],
      title: null,
      type: null,
      userMemoryIds: [memory.id],
    });
  });

  it('createExperienceMemory() falls back to the memory type, then to null', async () => {
    const typed = await memoryModel.createExperienceMemory({
      experience: {},
      memoryLayer: LayersEnum.Experience,
      memoryType: 'learning',
    } as any);
    const untyped = await memoryModel.createExperienceMemory({
      experience: {},
      memoryLayer: LayersEnum.Experience,
    } as any);

    expect(typed.memory.tags).toBeNull();
    expect(typed.experience).toMatchObject({
      action: null,
      keyLearning: null,
      possibleOutcome: null,
      reasoning: null,
      situation: null,
      tags: [],
      type: 'learning',
    });
    expect(untyped.experience.type).toBeNull();
  });

  it('createPreferenceMemory() fills omitted fields and a null type', async () => {
    const { memory, preference } = await memoryModel.createPreferenceMemory({
      memoryLayer: LayersEnum.Preference,
      preference: {},
    } as any);

    expect(memory).toMatchObject({ metadata: null, tags: null });
    expect(preference).toMatchObject({
      conclusionDirectives: null,
      metadata: null,
      scorePriority: null,
      suggestions: null,
      tags: [],
      type: null,
    });
  });
});

describe('UserMemoryModel detail lookups', () => {
  it('findUserMemoryRawById() returns undefined for an unknown id', async () => {
    await expect(
      (memoryModel as any).findUserMemoryRawById('missing-memory'),
    ).resolves.toBeUndefined();
  });

  it('getMemoryDetail() looks up the source topic through the model', async () => {
    const { context } = await memoryModel.createContextMemory({
      context: { metadata: { sourceId: 'missing-topic' } },
      memoryLayer: LayersEnum.Context,
    } as any);

    const detail = await memoryModel.getMemoryDetail({ id: context.id, layer: LayersEnum.Context });

    expect(detail).toMatchObject({
      layer: LayersEnum.Context,
      source: undefined,
      sourceType: MemorySourceType.ChatTopic,
    });
  });
});

describe('UserMemoryModel identity entry normalization', () => {
  const readIdentity = async (identityId: string) => {
    const [identity] = await serverDB
      .select()
      .from(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.id, identityId));
    return identity;
  };

  it('addIdentityEntry() defaults a missing base and identity', async () => {
    const { identityId, userMemoryId } = await memoryModel.addIdentityEntry({} as any);

    const identity = await readIdentity(identityId);
    const [memory] = await serverDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, userMemoryId));

    expect(memory).toMatchObject({ memoryLayer: 'identity', status: 'active' });
    expect(identity).toMatchObject({ episodicDate: null, relationship: null, type: null });
  });

  it('addIdentityEntry() keeps explicit nulls and drops unknown enum values', async () => {
    const explicitNull = await memoryModel.addIdentityEntry({
      base: { status: null },
      identity: { episodicDate: '2024-05-01', relationship: null, type: null },
    } as any);
    const unknownValues = await memoryModel.addIdentityEntry({
      identity: { relationship: 'stranger', type: 'cosmic' },
    } as any);

    const [memory] = await serverDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, explicitNull.userMemoryId));

    expect(memory.status).toBeNull();
    expect(await readIdentity(explicitNull.identityId)).toMatchObject({
      episodicDate: new Date('2024-05-01'),
      relationship: null,
      type: null,
    });
    expect(await readIdentity(unknownValues.identityId)).toMatchObject({
      relationship: null,
      type: null,
    });
  });

  it('addIdentityEntry() / updateIdentityEntry() store null for non-string enum values', async () => {
    // Tool payloads arrive as untyped JSON, so a number can reach the enum normalizers.
    const { identityId } = await memoryModel.addIdentityEntry({
      identity: { relationship: 7, type: 7 },
    } as any);

    expect(await readIdentity(identityId)).toMatchObject({ relationship: null, type: null });

    const typed = await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', type: 'personal' },
    } as any);
    await memoryModel.updateIdentityEntry({
      identity: { relationship: 7, type: 7 },
      identityId: typed.identityId,
    } as any);

    expect(await readIdentity(typed.identityId)).toMatchObject({ relationship: null, type: null });
  });

  it('updateIdentityEntry() skips writes for empty base and identity payloads', async () => {
    const { identityId } = await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', type: 'personal' },
    } as any);
    const before = await readIdentity(identityId);

    await expect(memoryModel.updateIdentityEntry({ base: {}, identityId })).resolves.toBe(true);
    await expect(memoryModel.updateIdentityEntry({ identity: {}, identityId })).resolves.toBe(true);

    expect((await readIdentity(identityId)).updatedAt).toEqual(before.updatedAt);
  });

  it('updateIdentityEntry() replaces an unparseable lastAccessedAt with now', async () => {
    const { identityId, userMemoryId } = await memoryModel.addIdentityEntry({
      base: { lastAccessedAt: new Date('2020-01-01') },
    } as any);

    await memoryModel.updateIdentityEntry({
      base: { lastAccessedAt: 'not-a-date' } as any,
      identityId,
    });

    const [memory] = await serverDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, userMemoryId));
    expect(memory.lastAccessedAt.getTime()).toBeGreaterThan(new Date('2020-01-02').getTime());
  });

  it('updateIdentityEntry(replace) normalizes null, unknown and valid enum values', async () => {
    const { identityId } = await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', type: 'personal' },
    } as any);

    await memoryModel.updateIdentityEntry({
      identity: { episodicDate: '2024-06-01', relationship: null, type: null } as any,
      identityId,
      mergeStrategy: MergeStrategyEnum.Replace,
    });
    expect(await readIdentity(identityId)).toMatchObject({
      episodicDate: new Date('2024-06-01'),
      relationship: null,
      type: null,
    });

    await memoryModel.updateIdentityEntry({
      identity: { relationship: 'stranger', type: 'cosmic' } as any,
      identityId,
      mergeStrategy: MergeStrategyEnum.Replace,
    });
    expect(await readIdentity(identityId)).toMatchObject({
      episodicDate: null,
      relationship: null,
      type: null,
    });

    await memoryModel.updateIdentityEntry({
      identity: { relationship: ' Self ', type: ' Personal ' } as any,
      identityId,
      mergeStrategy: MergeStrategyEnum.Replace,
    });
    expect(await readIdentity(identityId)).toMatchObject({
      relationship: 'self',
      type: 'personal',
    });
  });

  it('updateIdentityEntry(merge) normalizes null and unknown enum values and coerces dates', async () => {
    const { identityId } = await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', type: 'personal' },
    } as any);

    await memoryModel.updateIdentityEntry({
      identity: { episodicDate: '2024-07-01', relationship: null, type: null } as any,
      identityId,
    });
    expect(await readIdentity(identityId)).toMatchObject({
      episodicDate: new Date('2024-07-01'),
      relationship: null,
      type: null,
    });

    await memoryModel.updateIdentityEntry({
      identity: { relationship: 'stranger', type: 'cosmic' } as any,
      identityId,
    });
    expect(await readIdentity(identityId)).toMatchObject({ relationship: null, type: null });
  });
});

describe('UserMemoryModel.listMemories - parameter fallbacks', () => {
  it('normalizes null paging, honours ascending order and ignores unsupported layers', async () => {
    const first = await memoryModel.createContextMemory({
      context: { title: 'first' },
      memoryLayer: LayersEnum.Context,
    } as any);
    const second = await memoryModel.createContextMemory({
      context: { title: 'second' },
      memoryLayer: LayersEnum.Context,
    } as any);
    await serverDB
      .update(userMemoriesContexts)
      .set({ updatedAt: new Date('2020-01-01') })
      .where(eq(userMemoriesContexts.id, first.context.id));

    const items = await memoryModel.listMemories({
      layer: LayersEnum.Context,
      order: 'asc',
      page: null,
      pageSize: null,
    } as any);

    expect(items.map((item: any) => item.context.id)).toEqual([
      first.context.id,
      second.context.id,
    ]);
    await expect(memoryModel.listMemories({ layer: LayersEnum.Activity } as any)).resolves.toEqual(
      [],
    );
  });
});

describe('UserMemoryModel.queryMemories - filters and candidate paths', () => {
  it('defaults null page, size and layer to the first context page', async () => {
    await memoryModel.createContextMemory({ context: {}, memoryLayer: LayersEnum.Context } as any);

    const result = await memoryModel.queryMemories({
      layer: null,
      page: null,
      pageSize: null,
    } as any);

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items[0].layer).toBe(LayersEnum.Context);
  });

  it('filters contexts by category and type, forwarding them to the candidate source', async () => {
    const match = await memoryModel.createContextMemory({
      context: { scoreImpact: 0.9, scoreUrgency: 0.1, type: 'project' },
      memoryCategory: 'work',
      memoryLayer: LayersEnum.Context,
    } as any);
    await memoryModel.createContextMemory({
      context: { type: 'other' },
      memoryCategory: 'work',
      memoryLayer: LayersEnum.Context,
    } as any);
    const source = ftsSource([match.context.id]);
    const model = new UserMemoryModel(serverDB, userId, source);

    for (const sort of ['scoreUrgency', 'scoreImpact'] as const) {
      const result = await model.queryMemories({
        categories: ['work'],
        layer: LayersEnum.Context,
        order: 'asc',
        q: 'project',
        sort,
        types: ['project'],
      });

      expect(result.items.map((item: any) => item.context.id)).toEqual([match.context.id]);
    }
    expect(source.ftsSearchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'memoryContexts',
        filters: { memoryCategories: ['work'], memoryTypes: ['project'] },
      }),
    );
  });

  it('filters activities by type and status sorted by start time', async () => {
    const match = await memoryModel.createActivityMemory({
      activity: { startsAt: new Date('2024-01-01'), status: 'completed', type: 'event' },
      memoryLayer: LayersEnum.Activity,
    } as any);
    await memoryModel.createActivityMemory({
      activity: { status: 'pending', type: 'event' },
      memoryLayer: LayersEnum.Activity,
    } as any);

    const result = await memoryModel.queryMemories({
      layer: LayersEnum.Activity,
      sort: 'startsAt',
      status: ['completed'],
      types: ['event'],
    });

    expect(result.items.map((item: any) => item.activity.id)).toEqual([match.activity.id]);
  });

  it('hydrates experience candidates with type and tag filters', async () => {
    const match = await memoryModel.createExperienceMemory({
      experience: { scoreConfidence: 0.8, tags: ['focus'], type: 'learning' },
      memoryLayer: LayersEnum.Experience,
    } as any);
    await memoryModel.createExperienceMemory({
      experience: { tags: ['other'], type: 'learning' },
      memoryLayer: LayersEnum.Experience,
    } as any);
    const model = new UserMemoryModel(serverDB, userId, ftsSource([match.experience.id]));

    const result = await model.queryMemories({
      layer: LayersEnum.Experience,
      q: 'focus',
      sort: 'scoreConfidence',
      tags: ['focus'],
      types: ['learning'],
    });

    expect(result.items.map((item: any) => item.experience.id)).toEqual([match.experience.id]);
    expect(result.total).toBe(1);
  });

  it('hydrates identity candidates with type and tag filters', async () => {
    const match = await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', tags: ['core'], type: 'personal' },
    } as any);
    await memoryModel.addIdentityEntry({
      identity: { relationship: 'self', tags: ['core'], type: 'professional' },
    } as any);
    const model = new UserMemoryModel(serverDB, userId, ftsSource([match.identityId]));

    const result = await model.queryMemories({
      layer: LayersEnum.Identity,
      q: 'core',
      tags: ['core'],
      types: ['personal'],
    });

    expect(result.items.map((item: any) => item.identity.id)).toEqual([match.identityId]);
  });

  it('hydrates preference candidates with type and tag filters sorted by priority', async () => {
    const match = await memoryModel.createPreferenceMemory({
      memoryLayer: LayersEnum.Preference,
      preference: { scorePriority: 0.5, tags: ['style'], type: 'communication' },
    } as any);
    await memoryModel.createPreferenceMemory({
      memoryLayer: LayersEnum.Preference,
      preference: { tags: ['style'], type: 'other' },
    } as any);
    const model = new UserMemoryModel(serverDB, userId, ftsSource([match.preference.id]));

    const result = await model.queryMemories({
      layer: LayersEnum.Preference,
      q: 'style',
      sort: 'scorePriority',
      tags: ['style'],
      types: ['communication'],
    });

    expect(result.items.map((item: any) => item.preference.id)).toEqual([match.preference.id]);
  });
});

describe('context removal without linked memories', () => {
  const insertUnlinkedContext = async () => {
    const [context] = await serverDB
      .insert(userMemoriesContexts)
      .values({ title: 'unlinked', userId, userMemoryIds: null })
      .returning();
    return context;
  };

  it('UserMemoryModel.removeContextEntry() deletes a context whose memory ids are null', async () => {
    const context = await insertUnlinkedContext();

    await expect(memoryModel.removeContextEntry(context.id)).resolves.toBe(true);
    await expect(
      serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      }),
    ).resolves.toBeUndefined();
  });

  it('UserMemoryContextModel.delete() deletes a context whose memory ids are null', async () => {
    const context = await insertUnlinkedContext();

    await expect(new UserMemoryContextModel(serverDB, userId).delete(context.id)).resolves.toEqual({
      success: true,
    });
  });
});

describe('layer models queryList fallbacks', () => {
  const layerModels = [
    {
      Model: UserMemoryActivityModel,
      entity: 'memoryActivities',
      filters: { tags: ['t1'], types: ['event'] },
      expectedFilters: { memoryTagMatch: 'any', memoryTags: ['t1'], memoryTypes: ['event'] },
      name: 'activity',
    },
    {
      Model: UserMemoryExperienceModel,
      entity: 'memoryExperiences',
      filters: {},
      expectedFilters: {},
      name: 'experience',
    },
    {
      Model: UserMemoryIdentityModel,
      entity: 'memoryIdentities',
      filters: { tags: ['t1'], types: ['personal'] },
      expectedFilters: {
        memoryRelationships: ['self'],
        memoryTagMatch: 'any',
        memoryTags: ['t1'],
        memoryTypes: ['personal'],
      },
      name: 'identity',
    },
  ] as const;

  it.each(layerModels)(
    '$name forwards only the supplied filters to the candidate source',
    async ({ Model, entity, expectedFilters, filters }) => {
      const source = ftsSource([]);
      const model = new Model(serverDB, userId, source);

      const result = await model.queryList({ q: 'anything', ...filters } as any);

      expect(result.items).toEqual([]);
      expect(source.ftsSearchCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ entity, filters: expectedFilters }),
      );
    },
  );

  it.each(layerModels.filter(({ name }) => name !== 'identity'))(
    '$name queries without a WHERE clause and reports 0 when the count row is missing',
    async ({ Model }) => {
      const where = vi.fn((_clause?: unknown) => builder);
      const builder: any = chain([]);
      const select = vi.fn(() => ({
        from: () => ({ innerJoin: () => ({ where }) }),
      }));
      const model = new Model({ select } as any, userId);
      (model as any).memoryWhere = () => undefined;

      const result = await model.queryList();

      expect(result).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
      expect(where).toHaveBeenCalledTimes(2);
      expect(where.mock.calls.every(([clause]) => clause === undefined)).toBe(true);
    },
  );
});
