import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type KagiResponse, type KagiSearchParameters } from './type';

const log = debug('lobe-search:Kagi');

/**
 * Kagi implementation of the search service
 * Primarily used for web crawling
 */
export class KagiImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.KAGI_API_KEY;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://kagi.com/api/v0';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Kagi query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/search');

    const body: KagiSearchParameters = {
      limit: 15,
      q: query,
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
          Authorization: this.apiKey ? `Bot ${this.apiKey}` : '',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Kagi fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Kagi.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Kagi request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Kagi request failed: ${response.statusText}`,
      });
    }

    try {
      const kagiResponse = (await response.json()) as KagiResponse;

      log('Parsed Kagi response: %o', kagiResponse);

      const mappedResults = (kagiResponse.data || []).map(
        (result): UniformSearchResult => ({
          category: 'general', // Default category
          content: result.snippet || '', // Prioritize content
          engines: ['kagi'], // Use 'kagi' as the engine name
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
      log.extend('error')('Error parsing Kagi response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Kagi response.',
      });
    }
  }
}
