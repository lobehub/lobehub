import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type BraveResponse, type BraveSearchParameters } from './type';

const log = debug('lobe-search:Brave');

const timeRangeMapping = {
  day: 'pd',
  month: 'pm',
  week: 'pw',
  year: 'py',
};

/**
 * Brave implementation of the search service
 * Primarily used for web crawling
 */
export class BraveImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.BRAVE_API_KEY;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://api.search.brave.com/res/v1';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Brave query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/web/search');

    const defaultQueryParams: BraveSearchParameters = {
      count: 15,
      q: query,
      result_filter: 'web',
    };

    const body: BraveSearchParameters = {
      ...defaultQueryParams,
      freshness:
        params?.searchTimeRange && params.searchTimeRange !== 'anytime'
          ? (timeRangeMapping[params.searchTimeRange as keyof typeof timeRangeMapping] ?? undefined)
          : undefined,
    };

    log('Constructed request body: %o', body);

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      searchParams.append(key, String(value));
    }

    let response: Response;
    const startAt = Date.now();
    let costTime = 0;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(`${endpoint}?${searchParams.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey ? this.apiKey : '',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Brave fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Brave.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Brave request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Brave request failed: ${response.statusText}`,
      });
    }

    try {
      const braveResponse = (await response.json()) as BraveResponse;

      log('Parsed Brave response: %o', braveResponse);

      const mappedResults = (braveResponse.web.results || []).map(
        (result): UniformSearchResult => ({
          category: 'general', // Default category
          content: result.description || '', // Prioritize content
          engines: ['brave'], // Use 'brave' as the engine name
          parsedUrl: result.url ? new URL(result.url).hostname : '', // Basic URL parsing
          score: 1, // Default score to 1
          title: result.title || '',
          url: result.url,
        }),
      );

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query: query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing Brave response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Brave response.',
      });
    }
  }
}
