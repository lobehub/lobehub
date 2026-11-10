import {
  type DiscoverModelDetail,
  type DiscoverModelItem,
  type IdentifiersResponse,
  type ModelListResponse,
  type ModelQueryParams,
} from '@lobechat/types';
import { ModelSorts } from '@lobechat/types';
import {
  getAudioInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@lobechat/utils';
import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import dayjs from 'dayjs';
import { countBy, uniq } from 'es-toolkit/compat';
import { isAiModelVisible } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import type { DiscoverService } from './index';
import { loadBuiltinModels, log } from './utils';

// ============================== Helper Methods ==============================

/**
 * Calculate ModelAbilities completeness score
 * Higher score indicates more complete abilities
 */
export const calculateAbilitiesScore = (abilities?: any): number => {
  if (!abilities) return 0;

  let score = 0;
  const abilityWeights = {
    files: 1,
    functionCall: 1,
    imageOutput: 1,
    reasoning: 1,
    search: 1,
    vision: 1,
  };

  Object.entries(abilityWeights).forEach(([ability, weight]) => {
    if (abilities[ability]) {
      score += weight;
    }
  });

  log('calculateAbilitiesScore: abilities=%O, score=%d', abilities, score);
  return score;
};

/**
 * Select the model with the most complete abilities from model array
 * Combines the most complete abilities and largest contextWindowTokens
 */
export const selectModelWithBestAbilities = (models: DiscoverModelItem[]): DiscoverModelItem => {
  log('selectModelWithBestAbilities: input models count=%d', models.length);
  if (models.length === 1) return models[0];

  // Find the most complete abilities
  let bestAbilities: Record<string, boolean> = {};
  let maxAbilitiesScore = 0;
  models.forEach((model) => {
    const score = calculateAbilitiesScore(model.abilities);
    if (score > maxAbilitiesScore) {
      maxAbilitiesScore = score;
      bestAbilities = { ...(model.abilities as Record<string, boolean>) };
    } else if (score === maxAbilitiesScore && model.abilities) {
      // Merge abilities with the same score to ensure the most complete combination
      const abilities = model.abilities as Record<string, boolean>;
      Object.keys(abilities).forEach((key) => {
        if (abilities[key]) {
          bestAbilities[key] = true;
        }
      });
    }
  });

  // Find the largest contextWindowTokens
  const maxContextWindowTokens = Math.max(...models.map((model) => model.contextWindowTokens || 0));

  // Find the latest releasedAt
  const latestReleasedAt = models
    .map((model) => model.releasedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

  // Find the shortest identifier
  const shortestIdentifier = models
    .map((model) => model.identifier)
    .reduce((shortest, current) => (current.length < shortest.length ? current : shortest));

  // Select a base model (usually the first one)
  const baseModel = models[0];

  // Assemble final model using the best attributes
  const result: DiscoverModelItem = {
    ...baseModel,
    abilities: bestAbilities as any,
    contextWindowTokens: maxContextWindowTokens || baseModel.contextWindowTokens,
    identifier: shortestIdentifier,
    releasedAt: latestReleasedAt || baseModel.releasedAt,
  };

  log('selectModelWithBestAbilities: selected model=%O', {
    abilities: result.abilities,
    contextWindowTokens: result.contextWindowTokens,
    identifier: result.identifier,
    releasedAt: result.releasedAt,
  });
  return result;
};

// ============================== Models ==============================

export const listRawModelItems = async (): Promise<DiscoverModelItem[]> => {
  log('_getRawModelList: fetching raw model list');
  const builtinModels = await loadBuiltinModels();
  const visibleModels = builtinModels.filter(isAiModelVisible);
  const result = visibleModels.map((item) => {
    const identifier = (item.id.split('/').at(-1) || item.id).toLowerCase();
    const providers = uniq(
      visibleModels
        .filter(
          (m) =>
            m.id.toLowerCase() === identifier ||
            m.id.includes(`/${identifier}`) ||
            m.displayName?.toLowerCase() === item.displayName?.toLowerCase(),
        )
        .map((m) => m.providerId),
    );
    const model = {
      ...item,
      category: item.providerId,
      identifier,
      providerCount: providers.length,
      providers,
    };
    // Use simple merge instead of DEFAULT_DISCOVER_MODEL_ITEM to avoid type conflicts
    return {
      ...model,
      abilities: model.abilities || {},
    } as DiscoverModelItem;
  });
  log('_getRawModelList: returning %d raw models', result.length);
  return result;
};

export const listModelItems = async (category?: string): Promise<DiscoverModelItem[]> => {
  log('_getModelList: category=%s', category);
  let list = await listRawModelItems();
  const originalCount = list.length;

  if (category) {
    list = list.filter((item) => item.providerId === category);
    log(
      '_getModelList: filtered by category "%s", %d -> %d items',
      category,
      originalCount,
      list.length,
    );
  }

  // Optimize deduplication logic: select models with most complete abilities
  // 1. Group by identifier
  const identifierGroups = new Map<string, DiscoverModelItem[]>();
  list.forEach((item) => {
    const key = item.identifier;
    if (!identifierGroups.has(key)) {
      identifierGroups.set(key, []);
    }
    identifierGroups.get(key)!.push(item);
  });

  log(
    '_getModelList: grouped %d items into %d identifier groups',
    list.length,
    identifierGroups.size,
  );

  // 2. Select the model with most complete abilities from each identifier group
  const deduplicatedByIdentifier = Array.from(identifierGroups.values()).map((models) =>
    selectModelWithBestAbilities(models),
  );

  // 3. Group by displayName
  const displayNameGroups = new Map<string, DiscoverModelItem[]>();
  deduplicatedByIdentifier.forEach((item) => {
    const key = item.displayName?.toLowerCase() || '';
    if (!displayNameGroups.has(key)) {
      displayNameGroups.set(key, []);
    }
    displayNameGroups.get(key)!.push(item);
  });

  log(
    '_getModelList: grouped %d items into %d displayName groups',
    deduplicatedByIdentifier.length,
    displayNameGroups.size,
  );

  // 4. Select the model with most complete abilities from each displayName group
  const finalList: DiscoverModelItem[] = Array.from(displayNameGroups.values()).map((models) =>
    selectModelWithBestAbilities(models),
  );

  log('_getModelList: returning %d deduplicated models', finalList.length);
  return finalList;
};

export const getModelCategories = async (
  params: CategoryListQuery = {},
): Promise<CategoryItem[]> => {
  log('getModelCategories: params=%O', params);
  const { q } = params;
  const builtinModels = await loadBuiltinModels();
  let list = builtinModels.filter(isAiModelVisible);
  if (q) {
    const originalCount = list.length;
    list = list.filter((item) => {
      return [item.id, item.displayName, item.description]
        .flat()
        .filter(Boolean)
        .join(',')
        .toLowerCase()
        .includes(decodeURIComponent(q).toLowerCase());
    });
    log(
      'getModelCategories: filtered by query "%s", %d -> %d items',
      q,
      originalCount,
      list.length,
    );
  }
  const categoryCounts = countBy(list, (item) => item.providerId);
  const result = Object.entries(categoryCounts)
    .filter(([category]) => Boolean(category)) // Filter out empty values
    .map(([category, count]) => ({
      category,
      count,
    }));
  log('getModelCategories: returning %d categories', result.length);
  return result;
};

export const getModelDetail = async (
  service: DiscoverService,
  params: {
    identifier: string;
  },
): Promise<DiscoverModelDetail | undefined> => {
  log('getModelDetail: params=%O', params);
  const builtinModels = await loadBuiltinModels();
  const { identifier } = params;
  const all = await listModelItems();
  let model = all.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());

  if (!model) {
    log('getModelDetail: model not found in deduplicated list, searching raw list');
    const raw = await listRawModelItems();
    model = raw.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());
  }

  if (!model) {
    log('getModelDetail: model not found for identifier=%s', identifier);
    return;
  }

  const providers = DEFAULT_MODEL_PROVIDER_LIST.filter((item) =>
    model.providers?.includes(item.id),
  );
  log('getModelDetail: found %d providers for model %s', providers.length, model.identifier);

  const list = await service.getModelList({
    page: 1,
    pageSize: 7,
    q: model.identifier.split('-')[0],
  });

  const result = {
    ...model,
    providers: providers.map((item) => ({
      ...item,
      model: builtinModels.find((m) => {
        if (!isAiModelVisible(m)) return false;
        if (m.providerId !== item.id) return false;
        return (
          m.id.toLowerCase() === model.identifier.toLowerCase() ||
          m.id.toLowerCase().includes(`/${model.identifier.toLowerCase()}`) ||
          m.displayName?.toLowerCase() === model.displayName?.toLowerCase()
        );
      }),
    })),
    related: list.items
      .filter(
        (item) => item.identifier !== model.identifier && item.displayName !== model?.displayName,
      )
      .slice(0, 6),
  };
  log(
    'getModelDetail: returning model with %d providers and %d related items',
    result.providers.length,
    result.related.length,
  );
  return result;
};

export const getModelIdentifiers = async (): Promise<IdentifiersResponse> => {
  log('getModelIdentifiers: fetching identifiers');
  const list = await listModelItems();
  const result = list.map((item) => {
    return {
      identifier: item.identifier,
      lastModified: item.releasedAt || dayjs().toISOString(),
    };
  });
  log('getModelIdentifiers: returning %d identifiers', result.length);
  return result;
};

export const getModelList = async (params: ModelQueryParams = {}): Promise<ModelListResponse> => {
  log('getModelList: params=%O', params);
  const {
    category,
    order = 'desc',
    page = 1,
    pageSize = 20,
    q,
    sort = ModelSorts.ReleasedAt,
  } = params;
  let list = await listModelItems(category);

  // if (category) {
  //   list = list.filter((item) => item.category === category);
  // }

  if (q) {
    const beforeFilter = list.length;
    list = list.filter((item) => {
      return [item.identifier, item.displayName, item.description]
        .flat()
        .filter(Boolean)
        .join(',')
        .toLowerCase()
        .includes(decodeURIComponent(q).toLowerCase());
    });
    log('getModelList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
  }

  if (sort) {
    log('getModelList: sorting by %s %s', sort, order);
    switch (sort) {
      case ModelSorts.ReleasedAt: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return dayjs(a.releasedAt).unix() - dayjs(b.releasedAt).unix();
          } else {
            return dayjs(b.releasedAt).unix() - dayjs(a.releasedAt).unix();
          }
        });
        break;
      }
      case ModelSorts.Identifier: {
        list = list.sort((a, b) => {
          if (order === 'desc') {
            return a.identifier.localeCompare(b.identifier);
          } else {
            return b.identifier.localeCompare(a.identifier);
          }
        });
        break;
      }
      case ModelSorts.InputPrice: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return (
              (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0) -
              (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0)
            );
          } else {
            return (
              (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0) -
              (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0)
            );
          }
        });
        break;
      }
      case ModelSorts.OutputPrice: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return (
              (getTextOutputUnitRate(a.pricing) || 0) - (getTextOutputUnitRate(b.pricing) || 0)
            );
          } else {
            return (
              (getTextOutputUnitRate(b.pricing) || 0) - (getTextOutputUnitRate(a.pricing) || 0)
            );
          }
        });
        break;
      }
      case ModelSorts.ContextWindowTokens: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return (a.contextWindowTokens || 0) - (b.contextWindowTokens || 0);
          } else {
            return (b.contextWindowTokens || 0) - (a.contextWindowTokens || 0);
          }
        });
        break;
      }
      case ModelSorts.ProviderCount: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return a.providerCount - b.providerCount;
          } else {
            return b.providerCount - a.providerCount;
          }
        });
        break;
      }
    }
  }

  const result = {
    currentPage: page,
    items: list.slice((page - 1) * pageSize, page * pageSize),
    pageSize,
    totalCount: list.length,
    totalPages: Math.ceil(list.length / pageSize),
  };
  log(
    'getModelList: returning page %d/%d with %d items',
    page,
    result.totalPages,
    result.items.length,
  );
  return result;
};
