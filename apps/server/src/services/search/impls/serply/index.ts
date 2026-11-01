import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type SerplyResponse, type SerplySearchParameters } from './type';

const log = debug('lobe-search:Serply');

const timeRangeMapping = {
  day: 'qdr:d',
  month: 'qdr:m',
  week: 'qdr:w',
  year: 'qdr:y',
};

/**
 * Serply implementation of the search service
 * Returns Google results through the Serply API
 */
export class SerplyImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.SERPLY_API_KEY;
  }

  private get baseUrl(): string {
    return 'https://api.serply.io/v1';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Serply query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/search');

    const defaultQueryParams: SerplySearchParameters = {
      num: 15,
      q: query,
    };

    const body: SerplySearchParameters = {
      ...defaultQueryParams,
      tbs:
        params?.searchTimeRange && params.searchTimeRange !== 'anytime'
          ? (timeRangeMapping[params.searchTimeRange as keyof typeof timeRangeMapping] ?? undefined)
          : undefined,
    };

    log('Constructed request body: %o', body);

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      // Serply treats an unknown tbs value as no filter, so omit it when unset
      if (value === undefined) continue;
      searchParams.append(key, String(value));
    }

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(`${endpoint}?${searchParams.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'lobehub',
          'X-Api-Key': this.apiKey ?? '',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Serply fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Serply.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Serply request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Serply request failed: ${response.statusText}`,
      });
    }

    try {
      const serplyResponse = (await response.json()) as SerplyResponse;

      log('Parsed Serply response: %o', serplyResponse);

      const mappedResults = (serplyResponse.results || []).map((result): UniformSearchResult => ({
        category: 'general', // Default category
        content: result.description || '', // Prioritize content
        engines: ['serply'], // Use 'serply' as the engine name
        parsedUrl: result.link ? new URL(result.link).hostname : '', // Basic URL parsing
        score: 1, // Default score to 1
        title: result.title || '',
        url: result.link,
      }));

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing Serply response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Serply response.',
      });
    }
  }
}
