import { type UniformSearchResponse } from '@lobechat/types';
import { SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { toolsEnv } from '@/envs/tools';
import { SearXNGClient } from '@/server/services/search/impls/searxng/client';

import { type SearchServiceImpl } from '../type';

/**
 * SearXNG implementation of the search service
 */
export class SearXNGImpl implements SearchServiceImpl {
  async query(
    query: string,
    params?: {
      searchCategories?: string[];
      searchEngines?: string[];
      searchTimeRange?: string;
    },
  ): Promise<UniformSearchResponse> {
    if (!toolsEnv.SEARXNG_URL) {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: SEARCH_SEARXNG_NOT_CONFIG });
    }

    const client = new SearXNGClient(toolsEnv.SEARXNG_URL);

    try {
      let costTime = 0;
      const startAt = Date.now();
      const data = await client.search(query, {
        categories: params?.searchCategories,
        engines: params?.searchEngines,
        time_range: params?.searchTimeRange,
      });
      costTime = Date.now() - startAt;

      return {
        costTime,
        query,
        resultNumbers: data.number_of_results,
        results: data.results.map((item) => ({
          category: item.category,
          content: item.content!,
          engines: item.engines,
          parsedUrl: item.url ? new URL(item.url).hostname : '',
          publishedDate: item.publishedDate || undefined,
          score: item.score,
          thumbnail: item.thumbnail || undefined,
          title: item.title,
          url: item.url,
        })),
      };
    } catch (e) {
      console.error(e);

      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: (e as Error).message,
      });
    }
  }
}
