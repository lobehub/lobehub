import { DEFAULT_DISCOVER_PROVIDER_ITEM } from '@lobechat/const';
import {
  type DiscoverProviderDetail,
  type DiscoverProviderItem,
  type IdentifiersResponse,
  type ProviderListResponse,
  type ProviderQueryParams,
} from '@lobechat/types';
import { CacheTag, ProviderSorts } from '@lobechat/types';
import dayjs from 'dayjs';
import { cloneDeep, merge, uniq, uniqBy } from 'es-toolkit/compat';
import matter from 'gray-matter';
import { isAiModelVisible } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import urlJoin from 'url-join';

import { normalizeLocale } from '@/locales/resources';

import type { DiscoverService } from './index';
import { loadBuiltinModels, log } from './utils';

// ============================== Providers ==============================

export const listProviderItems = async (): Promise<DiscoverProviderItem[]> => {
  log('_getProviderList: fetching provider list');
  const builtinModels = await loadBuiltinModels();
  const result = DEFAULT_MODEL_PROVIDER_LIST.map((item) => {
    const models = uniq(
      builtinModels.filter((m) => m.providerId === item.id && isAiModelVisible(m)).map((m) => m.id),
    );
    const provider = {
      ...item,
      identifier: item.id,
      modelCount: models.length,
      models,
    };
    return merge(cloneDeep(DEFAULT_DISCOVER_PROVIDER_ITEM), provider);
  });
  log('_getProviderList: returning %d providers', result.length);
  return result;
};

export const getProviderDetail = async (
  service: DiscoverService,
  params: {
    identifier: string;
    locale?: string;
    withReadme?: boolean;
  },
): Promise<DiscoverProviderDetail | undefined> => {
  log('getProviderDetail: params=%O', params);
  const { identifier, locale, withReadme } = params;
  const builtinModels = await loadBuiltinModels();
  const all = await listProviderItems();
  const provider = all.find((item) => item.identifier === identifier);
  if (!provider) {
    log('getProviderDetail: provider not found for identifier=%s', identifier);
    return;
  }

  const list = await service.getProviderList({
    page: 1,
    pageSize: 7,
  });

  let readme;

  if (withReadme) {
    log('getProviderDetail: fetching readme for provider=%s', identifier);
    try {
      const normalizedLocale = normalizeLocale(locale);
      const readmeUrl = urlJoin(
        'https://raw.githubusercontent.com/lobehub/lobehub/refs/heads/main/docs/usage/providers',
        normalizedLocale === 'zh-CN' ? `${identifier}.zh-CN.mdx` : `${identifier}.mdx`,
      );
      log('getProviderDetail: readme URL=%s', readmeUrl);
      const res = await fetch(readmeUrl, {
        next: {
          tags: [CacheTag.Discover, CacheTag.Providers],
        },
      });

      const data = await res.text();
      const { content } = matter(data);
      readme = content.trimEnd();
      log('getProviderDetail: readme loaded successfully, length=%d', readme.length);
    } catch (error) {
      log('getProviderDetail: failed to load readme for provider=%s, error: %O', identifier, error);
    }
  }

  const result = {
    ...provider,
    models: uniqBy(
      builtinModels.filter((m) => m.providerId === provider.id && isAiModelVisible(m)),
      (item) => item.id,
    ),
    readme,
    related: list.items.filter((item) => item.identifier !== provider.identifier).slice(0, 6),
  };
  log(
    'getProviderDetail: returning provider with %d models and %d related items',
    result.models.length,
    result.related.length,
  );
  return result;
};

export const getProviderIdentifiers = async (): Promise<IdentifiersResponse> => {
  log('getProviderIdentifiers: fetching identifiers');
  const list = await listProviderItems();
  const result = list.map((item) => {
    return {
      identifier: item.identifier,
      lastModified: dayjs().toISOString(),
    };
  });
  log('getProviderIdentifiers: returning %d identifiers', result.length);
  return result;
};

export const getProviderList = async (
  params: ProviderQueryParams = {},
): Promise<ProviderListResponse> => {
  log('getProviderList: params=%O', params);
  const { page = 1, pageSize = 20, q, sort = ProviderSorts.Default, order = 'desc' } = params;
  let list = await listProviderItems();
  const originalCount = list.length;

  if (q) {
    list = list.filter((item) => {
      return [item.identifier, item.description, item.name]
        .filter(Boolean)
        .join(',')
        .toLowerCase()
        .includes(decodeURIComponent(q).toLowerCase());
    });
    log('getProviderList: filtered by query "%s", %d -> %d items', q, originalCount, list.length);
  }

  if (sort) {
    log('getProviderList: sorting by %s %s', sort, order);
    switch (sort) {
      case ProviderSorts.Identifier: {
        list = list.sort((a, b) => {
          if (order === 'desc') {
            return a.identifier.localeCompare(b.identifier);
          } else {
            return b.identifier.localeCompare(a.identifier);
          }
        });
        break;
      }
      case ProviderSorts.ModelCount: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return a.modelCount - b.modelCount;
          } else {
            return b.modelCount - a.modelCount;
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
    'getProviderList: returning page %d/%d with %d items',
    page,
    result.totalPages,
    result.items.length,
  );
  return result;
};
