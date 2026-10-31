// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';

const createModel = () => new UserMemoryModel({} as LobeChatDatabase, 'surface-test-user');

const functionMembers = (target: object) =>
  Object.getOwnPropertyNames(target)
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof (target as Record<string, unknown>)[name] === 'function')
    .sort();

describe('UserMemoryModel surface', () => {
  it('keeps every instance method', () => {
    expect(functionMembers(createModel())).toEqual([
      'addIdentityEntry',
      'create',
      'createActivityMemory',
      'createContextMemory',
      'createExperienceMemory',
      'createPreferenceMemory',
      'delete',
      'deleteAll',
      'findById',
      'findUserMemoryRawById',
      'getAllIdentities',
      'getAllIdentitiesWithMemory',
      'getIdentitiesByType',
      'getMemoryDetail',
      'listMemories',
      'queryIdentityRoles',
      'queryMemories',
      'queryTags',
      'queryTaxonomyOptions',
      'removeContextEntry',
      'removeExperienceEntry',
      'removeIdentityEntry',
      'removePreferenceEntry',
      'search',
      'searchActivities',
      'searchContexts',
      'searchExperiences',
      'searchMemory',
      'searchPreferences',
      'searchWithEmbedding',
      'update',
      'updateAccessMetrics',
      'updateActivityVectors',
      'updateContextVectors',
      'updateExperienceVectors',
      'updateIdentityEntry',
      'updateIdentityVectors',
      'updatePreferenceVectors',
      'updateUserMemoryVectors',
    ]);
  });

  it('keeps the prototype helpers and static parsers', () => {
    expect(functionMembers(UserMemoryModel.prototype)).toEqual([
      'buildBaseMemoryInsertValues',
      'extractSourceMetadata',
      'memoryWhere',
    ]);
    expect(functionMembers(UserMemoryModel)).toEqual([
      'parseAssociatedLocations',
      'parseAssociatedObjects',
      'parseAssociatedSubjects',
      'parseDateFromString',
    ]);
  });

  it('dispatches search through the instance layer searches and access metrics', async () => {
    const model = createModel();
    const activity = { id: 'a1', userMemoryId: 'm-activity' };
    const context = { id: 'c1', userMemoryIds: ['m-context-1', 'm-context-2'] };
    const experience = { id: 'e1', userMemoryId: 'm-experience' };
    const preference = { id: 'p1', userMemoryId: 'm-preference' };

    const searchActivities = vi
      .spyOn(model, 'searchActivities')
      .mockResolvedValue([activity] as any);
    const searchContexts = vi.spyOn(model, 'searchContexts').mockResolvedValue([context] as any);
    const searchExperiences = vi
      .spyOn(model, 'searchExperiences')
      .mockResolvedValue([experience] as any);
    const searchPreferences = vi
      .spyOn(model, 'searchPreferences')
      .mockResolvedValue([preference] as any);
    const updateAccessMetrics = vi
      .spyOn(model as any, 'updateAccessMetrics')
      .mockResolvedValue(undefined);

    const result = await model.search({
      embedding: [0.5],
      limits: { activities: 1, contexts: 2, experiences: 3, preferences: 4 },
    });

    expect(searchActivities).toHaveBeenCalledWith({ embedding: [0.5], limit: 1 });
    expect(searchContexts).toHaveBeenCalledWith({ embedding: [0.5], limit: 2 });
    expect(searchExperiences).toHaveBeenCalledWith({ embedding: [0.5], limit: 3 });
    expect(searchPreferences).toHaveBeenCalledWith({ embedding: [0.5], limit: 4 });
    expect(updateAccessMetrics).toHaveBeenCalledWith(
      ['m-experience', 'm-preference', 'm-activity', 'm-context-1', 'm-context-2'],
      { contextIds: ['c1'], timestamp: expect.any(Date) },
    );
    expect(result).toEqual({
      activities: [activity],
      contexts: [context],
      experiences: [experience],
      preferences: [preference],
    });
  });

  it('dispatches searchMemory through the query model', async () => {
    const model = createModel();
    const searchMemory = vi
      .spyOn((model as any).queryModel, 'searchMemory')
      .mockResolvedValue({ activities: [] });

    await expect(model.searchMemory({ queries: ['q'] } as any, [[0.1]])).resolves.toEqual({
      activities: [],
    });
    expect(searchMemory).toHaveBeenCalledWith({ queries: ['q'] }, [[0.1]]);
  });
});
