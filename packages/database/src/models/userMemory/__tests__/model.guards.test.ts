// @vitest-environment node
import { ActivityTypeEnum, LayersEnum, MemorySourceType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { userMemoriesActivities, userMemoriesContexts } from '../../../schemas';
import { updateAccessMetrics } from '../model/accessMetrics';
import type { UserMemoryModelContext } from '../model/context';
import {
  createActivityMemory,
  createContextMemory,
  createExperienceMemory,
  createPreferenceMemory,
} from '../model/create';
import { getMemoryDetail } from '../model/detail';
import { search } from '../model/search';

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

const createCtx = (overrides: Partial<Record<keyof UserMemoryModelContext, unknown>> = {}) =>
  ({
    buildBaseMemoryInsertValues: vi.fn(() => ({ memoryLayer: 'context', userId: 'guard-user' })),
    extractSourceMetadata: vi.fn(() => ({})),
    findUserMemoryRawById: vi.fn(),
    memoryWhere: vi.fn(() => undefined),
    topicModel: { findById: vi.fn() },
    updateAccessMetrics: vi.fn(),
    userId: 'guard-user',
    ...overrides,
  }) as unknown as UserMemoryModelContext;

describe('updateAccessMetrics guards', () => {
  it('skips the transaction when there is nothing to touch', async () => {
    const transaction = vi.fn();
    const ctx = createCtx({ db: { transaction } });

    await updateAccessMetrics(ctx, [], {});
    await updateAccessMetrics(ctx, []);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('touches only the context rows, in sorted order, when no memory ids are given', async () => {
    const update = vi.fn(() => chain([]));
    const select = vi.fn(() => chain([]));
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
      callback({ select, update }),
    );
    const ctx = createCtx({ db: { transaction } });

    await updateAccessMetrics(ctx, [], { contextIds: ['ctx-b', 'ctx-a'] });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(userMemoriesContexts);
  });
});

describe('create* guards', () => {
  const emptyInsertCtx = () => {
    const tx = { insert: vi.fn(() => chain([])) };
    return createCtx({
      db: { transaction: async (callback: (tx: unknown) => unknown) => callback(tx) },
    });
  };

  it('throws when the base context memory insert returns no row', async () => {
    await expect(
      createContextMemory(emptyInsertCtx(), {
        context: {},
        memoryLayer: LayersEnum.Context,
      } as any),
    ).rejects.toThrow('Failed to create user memory context');
  });

  it('throws when the base experience memory insert returns no row', async () => {
    await expect(
      createExperienceMemory(emptyInsertCtx(), {
        experience: {},
        memoryLayer: LayersEnum.Experience,
      } as any),
    ).rejects.toThrow('Failed to create user memory experience');
  });

  it('throws when the base activity memory insert returns no row', async () => {
    await expect(
      createActivityMemory(emptyInsertCtx(), {
        activity: {},
        memoryLayer: LayersEnum.Activity,
      } as any),
    ).rejects.toThrow('Failed to create user memory activity');
  });

  it('fills every omitted activity field, including the nullable status', async () => {
    // The activity `status` column is NOT NULL, so the `?? null` fallback can only be observed
    // on the values handed to the insert, not on a persisted row.
    const inserted: [unknown, Record<string, unknown>][] = [];
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserted.push([table, values]);
          return { returning: async () => [{ id: 'mem-1', ...values }] };
        },
      })),
    };
    const ctx = createCtx({
      db: { transaction: async (callback: (tx: unknown) => unknown) => callback(tx) },
    });

    await createActivityMemory(ctx, { activity: {}, memoryLayer: LayersEnum.Activity } as any);

    expect(ctx.buildBaseMemoryInsertValues).toHaveBeenCalledWith(expect.anything(), {
      metadata: null,
      status: 'pending',
      tags: null,
    });
    expect(inserted[1][0]).toBe(userMemoriesActivities);
    expect(inserted[1][1]).toMatchObject({
      associatedLocations: null,
      associatedObjects: [],
      associatedSubjects: [],
      narrative: null,
      status: null,
      tags: [],
      type: ActivityTypeEnum.Other,
      userMemoryId: 'mem-1',
    });
  });

  it('throws when the base preference memory insert returns no row', async () => {
    await expect(
      createPreferenceMemory(emptyInsertCtx(), {
        memoryLayer: LayersEnum.Preference,
        preference: {},
      } as any),
    ).rejects.toThrow('Failed to create user memory preference');
  });
});

describe('getMemoryDetail guards', () => {
  const layerRows = {
    [LayersEnum.Activity]: { id: 'activity-1', metadata: null, userMemoryId: 'mem-1' },
    [LayersEnum.Context]: { id: 'context-1', metadata: null, userMemoryIds: ['mem-1'] },
    [LayersEnum.Experience]: { id: 'experience-1', metadata: null, userMemoryId: 'mem-1' },
    [LayersEnum.Identity]: { id: 'identity-1', metadata: null, userMemoryId: 'mem-1' },
    [LayersEnum.Preference]: { id: 'preference-1', metadata: null, userMemoryId: 'mem-1' },
  } as const;
  const layers = Object.keys(layerRows) as (keyof typeof layerRows)[];

  const detailCtx = (row: unknown, memory: unknown, sourceId?: string) =>
    createCtx({
      db: { select: () => chain(row ? [row] : []) },
      extractSourceMetadata: vi.fn(() => ({
        sourceId,
        sourceType: MemorySourceType.ChatTopic,
      })),
      findUserMemoryRawById: vi.fn(async () => memory),
      topicModel: { findById: vi.fn(async (id: string) => ({ id, title: 'Source topic' })) },
    });

  it.each(layers)('returns undefined when the %s parent memory is gone', async (layer) => {
    const ctx = detailCtx(layerRows[layer], undefined);

    await expect(getMemoryDetail(ctx, { id: 'x', layer })).resolves.toBeUndefined();
    expect(ctx.findUserMemoryRawById).toHaveBeenCalledWith('mem-1');
  });

  it.each(layers)(
    'returns undefined when the %s parent memory belongs to another layer',
    async (layer) => {
      const otherLayer = layer === LayersEnum.Context ? LayersEnum.Activity : LayersEnum.Context;
      const ctx = detailCtx(layerRows[layer], { id: 'mem-1', memoryLayer: otherLayer });

      await expect(getMemoryDetail(ctx, { id: 'x', layer })).resolves.toBeUndefined();
      expect(ctx.extractSourceMetadata).not.toHaveBeenCalled();
    },
  );

  it.each(layers)('resolves the source topic for a %s detail with a sourceId', async (layer) => {
    const memory = { id: 'mem-1', memoryLayer: layer };
    const ctx = detailCtx(layerRows[layer], memory, 'topic-1');

    const result = await getMemoryDetail(ctx, { id: 'x', layer });

    expect(ctx.topicModel.findById).toHaveBeenCalledWith('topic-1');
    expect(result).toMatchObject({
      layer,
      memory,
      source: { id: 'topic-1', title: 'Source topic' },
      sourceType: MemorySourceType.ChatTopic,
    });
  });

  it('treats a non-array context userMemoryIds as having no parent', async () => {
    const ctx = detailCtx({ id: 'context-1', metadata: null, userMemoryIds: null }, undefined);

    await expect(
      getMemoryDetail(ctx, { id: 'context-1', layer: LayersEnum.Context }),
    ).resolves.toBeUndefined();
    expect(ctx.findUserMemoryRawById).not.toHaveBeenCalled();
  });

  it('returns undefined when the preference row is missing or has no parent id', async () => {
    const missing = detailCtx(undefined, undefined);
    const orphan = detailCtx({ id: 'preference-1', userMemoryId: null }, undefined);

    await expect(
      getMemoryDetail(missing, { id: 'preference-1', layer: LayersEnum.Preference }),
    ).resolves.toBeUndefined();
    await expect(
      getMemoryDetail(orphan, { id: 'preference-1', layer: LayersEnum.Preference }),
    ).resolves.toBeUndefined();
    expect(orphan.findUserMemoryRawById).not.toHaveBeenCalled();
  });
});

describe('search guards', () => {
  it('skips rows without parent ids but still records the context links', async () => {
    const experiences = [{ id: 'experience-1', userMemoryId: null }];
    const preferences = [{ id: 'preference-1', userMemoryId: null }];
    const activities = [{ id: 'activity-1', userMemoryId: null }];
    const contexts = [{ id: 'context-1', userMemoryIds: null }];
    const ctx = createCtx({
      searchActivities: vi.fn(async () => activities),
      searchContexts: vi.fn(async () => contexts),
      searchExperiences: vi.fn(async () => experiences),
      searchPreferences: vi.fn(async () => preferences),
    });

    const result = await search(ctx, { embedding: [0.1] } as any);

    expect(result).toMatchObject({ activities, contexts, experiences, preferences });
    expect(ctx.updateAccessMetrics).toHaveBeenCalledWith([], {
      contextIds: ['context-1'],
      timestamp: expect.any(Date),
    });
  });
});
