// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../../type';
import * as queryModule from '../query';
import { UserMemoryQueryModel } from '../query';

const createModel = () => new UserMemoryQueryModel({} as LobeChatDatabase, 'surface-test-user');

const functionMembers = (target: object) =>
  Object.getOwnPropertyNames(target)
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof (target as Record<string, unknown>)[name] === 'function')
    .sort();

describe('UserMemoryQueryModel surface', () => {
  it('keeps the module runtime exports', () => {
    expect(Object.keys(queryModule).sort()).toEqual([
      'USER_MEMORY_LEXICAL_QUERY_CHARACTER_LIMIT',
      'UserMemoryQueryModel',
      'buildBm25MatchCondition',
      'normalizeUserMemorySearchQueries',
      'scoreHybridCandidates',
      'shouldRunUserMemoryLexicalSearch',
    ]);
    expect(queryModule.USER_MEMORY_LEXICAL_QUERY_CHARACTER_LIMIT).toBe(256);
  });

  it('keeps the public instance methods', () => {
    expect(functionMembers(createModel())).toEqual(['queryTaxonomyOptions', 'searchMemory']);
  });

  it('keeps the per-layer retrieval methods on the instance prototype', () => {
    expect(functionMembers(UserMemoryQueryModel.prototype)).toEqual(
      expect.arrayContaining([
        'aggregateBaseArrayOptions',
        'aggregateBaseMemoryOptions',
        'aggregateIdentityValueOptions',
        'aggregateLayerLabels',
        'aggregateLayerTypes',
        'aggregateStatuses',
        'searchActivitiesLexical',
        'searchActivitiesSemantic',
        'searchContextsLexical',
        'searchContextsSemantic',
        'searchExperiencesLexical',
        'searchExperiencesSemantic',
        'searchHybridActivities',
        'searchHybridContexts',
        'searchHybridExperiences',
        'searchHybridIdentities',
        'searchHybridPreferences',
        'searchIdentitiesLexical',
        'searchIdentitiesSemantic',
        'searchPreferencesLexical',
        'searchPreferencesSemantic',
      ]),
    );
  });

  it('dispatches queryTaxonomyOptions through the instance aggregations', async () => {
    const model = createModel();
    const option = (value: string) => [{ count: 1, layers: undefined, value }];

    const baseMemory = vi
      .spyOn(model as any, 'aggregateBaseMemoryOptions')
      .mockResolvedValue(option('category'));
    const baseArray = vi
      .spyOn(model as any, 'aggregateBaseArrayOptions')
      .mockResolvedValue(option('tag'));
    const labels = vi
      .spyOn(model as any, 'aggregateLayerLabels')
      .mockResolvedValue(option('label'));
    const types = vi.spyOn(model as any, 'aggregateLayerTypes').mockResolvedValue(option('type'));
    const statuses = vi
      .spyOn(model as any, 'aggregateStatuses')
      .mockResolvedValue(option('status'));
    const identity = vi
      .spyOn(model as any, 'aggregateIdentityValueOptions')
      .mockResolvedValueOnce(option('relationship'))
      .mockResolvedValueOnce(option('role'));

    const result = await model.queryTaxonomyOptions({ limit: 1, q: 'x' });

    expect(baseMemory).toHaveBeenCalledOnce();
    expect(baseArray).toHaveBeenCalledOnce();
    expect(labels).toHaveBeenCalledWith({
      layers: undefined,
      limit: 1,
      q: 'x',
      timeRange: undefined,
    });
    expect(types).toHaveBeenCalledOnce();
    expect(statuses).toHaveBeenCalledOnce();
    expect(identity).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      categories: option('category'),
      hasMore: {
        categories: true,
        labels: true,
        relationships: true,
        roles: true,
        statuses: true,
        tags: true,
        types: true,
      },
      labels: option('label'),
      relationships: option('relationship'),
      roles: option('role'),
      statuses: option('status'),
      tags: option('tag'),
      types: option('type'),
    });
  });

  it('dispatches hybrid layer retrieval through the instance lexical and semantic searches', async () => {
    const model = createModel();
    const lexical = vi.spyOn(model as any, 'searchPreferencesLexical').mockResolvedValue([]);
    const semantic = vi.spyOn(model as any, 'searchPreferencesSemantic').mockResolvedValue([]);
    vi.spyOn(model as any, 'loadBaseSignals').mockResolvedValue(new Map());

    await expect(
      (model as any).searchHybridPreferences({
        embeddings: [[0.1, 0.2]],
        lexicalSearch: true,
        params: { topK: { preferences: 2 } },
        queries: ['short query'],
      }),
    ).resolves.toEqual([]);

    expect(semantic).toHaveBeenCalledWith([0.1, 0.2], 6, { topK: { preferences: 2 } });
    expect(lexical).toHaveBeenCalledWith('short query', 6, { topK: { preferences: 2 } });
  });
});
