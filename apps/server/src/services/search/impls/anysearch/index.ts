import type { SearchParams, UniformSearchResponse, UniformSearchResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import type { SearchServiceImpl } from '../type';
import type { AnySearchResponse } from './type';

const log = debug('lobe-search:AnySearch');
const ANYSEARCH_SEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search';
const DEFAULT_MAX_RESULTS = 10;

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export class AnySearchImpl implements SearchServiceImpl {
  /**
   * AnySearch chooses the backing engine/domain itself. LobeHub's search engine
   * names (google, bing, etc.) must not be forwarded as AnySearch parameters.
   */
  readonly useAutoSearchEngineSelection = true;

  async query(query: string, _params: SearchParams = {}): Promise<UniformSearchResponse> {
    const apiKey = process.env.ANYSEARCH_API_KEY?.trim();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const startAt = Date.now();
    let response: Response;

    try {
      response = await fetch(ANYSEARCH_SEARCH_ENDPOINT, {
        body: JSON.stringify({ max_results: DEFAULT_MAX_RESULTS, query }),
        headers,
        method: 'POST',
      });
    } catch (error) {
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to AnySearch.',
      });
    }

    if (!response.ok) {
      log.extend('error')('AnySearch request failed with status %d', response.status);
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: `AnySearch request failed: ${response.statusText}`,
      });
    }

    let payload: AnySearchResponse;
    try {
      payload = (await response.json()) as AnySearchResponse;
    } catch (error) {
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse AnySearch response.',
      });
    }

    if (payload.code !== 0 || !payload.data) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: payload.message
          ? `AnySearch request failed: ${payload.message}`
          : 'AnySearch request failed.',
      });
    }

    const mappedResults = (payload.data.results || []).flatMap((result): UniformSearchResult[] => {
      if (!result.url || !isHttpUrl(result.url)) return [];

      return [
        {
          category: 'general',
          content: result.content || result.snippet || '',
          engines: ['anysearch'],
          parsedUrl: new URL(result.url).hostname,
          score: 0,
          title: result.title || '',
          url: result.url,
        },
      ];
    });

    return {
      costTime: payload.data.metadata?.search_time_ms ?? Date.now() - startAt,
      query,
      resultNumbers: mappedResults.length,
      results: mappedResults,
    };
  }
}
