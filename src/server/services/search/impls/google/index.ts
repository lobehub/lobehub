import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type GoogleResponse, type GoogleSearchParameters } from './type';

const log = debug('lobe-search:Google');

const timeRangeMapping = {
  day: 'd1',
  month: 'm1',
  week: 'w1',
  year: 'y1',
};

/**
 * Google implementation of the search service
 * Primarily used for web crawling
 */
export class GoogleImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.GOOGLE_PSE_API_KEY;
  }

  private get engineId(): string | undefined {
    return process.env.GOOGLE_PSE_ENGINE_ID;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://www.googleapis.com';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Google query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/customsearch/v1');

    const defaultQueryParams: GoogleSearchParameters = {
      cx: this.engineId || '',
      key: this.apiKey || '',
      num: 10,
      q: query,
    };

    const body: GoogleSearchParameters = {
      ...defaultQueryParams,
      dateRestrict:
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
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Google fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Google.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Google request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Google request failed: ${response.statusText}`,
      });
    }

    try {
      const googleResponse = (await response.json()) as GoogleResponse;

      log('Parsed Google response: %o', googleResponse);

      const mappedResults = (googleResponse.items || []).map(
        (result): UniformSearchResult => ({
          category: 'general', // Default category
          content: result.snippet || '', // Prioritize content
          engines: ['google'], // Use 'google' as the engine name
          parsedUrl: result.link ? new URL(result.link).hostname : '', // Basic URL parsing
          score: 1, // Default score to 1
          title: result.title || '',
          url: result.link,
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
      log.extend('error')('Error parsing Google response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Google response.',
      });
    }
  }
}
