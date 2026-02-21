import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type AnspireResponse, type AnspireSearchParameters } from './type';

const log = debug('lobe-search:Anspire');

/**
 * Anspire implementation of the search service
 * Primarily used for web crawling
 */
export class AnspireImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.ANSPIRE_API_KEY;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://plugin.anspire.cn/api';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Anspire query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/ntsearch/search');

    const defaultQueryParams: AnspireSearchParameters = {
      mode: 0,
      query,
      top_k: 20,
    };

    const body: AnspireSearchParameters = {
      ...defaultQueryParams,
      ...(params?.searchTimeRange && params.searchTimeRange !== 'anytime'
        ? (() => {
            const now = Date.now();
            const days = { day: 1, month: 30, week: 7, year: 365 }[params.searchTimeRange!];

            if (days === undefined) return {};

            return {
              FromTime: new Date(now - days * 86_400 * 1000)
                .toISOString()
                .slice(0, 19)
                .replace('T', ' '),
              ToTime: new Date(now).toISOString().slice(0, 19).replace('T', ' '),
            };
          })()
        : {}),
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
          'Accept': '*/*',
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Connection': 'keep-alive ',
          'Content-Type': 'application/json',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Anspire fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Anspire.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Anspire request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Anspire request failed: ${response.statusText}`,
      });
    }

    try {
      const anspireResponse = (await response.json()) as AnspireResponse;

      log('Parsed Anspire response: %o', anspireResponse);

      const mappedResults = (anspireResponse.results || []).map(
        (result): UniformSearchResult => ({
          category: 'general', // Default category
          content: result.content || '', // Prioritize content
          engines: ['anspire'], // Use 'anspire' as the engine name
          parsedUrl: result.url ? new URL(result.url).hostname : '', // Basic URL parsing
          score: result.score || 0, // Default score to 0 if undefined
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
      log.extend('error')('Error parsing Anspire response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Anspire response.',
      });
    }
  }
}
