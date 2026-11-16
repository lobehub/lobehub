import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type KeirolabsResponse, type KeirolabsSearchParameters } from './type';

const log = debug('lobe-search:Keirolabs');

/**
 * Keirolabs implementation of the search service.
 * The lite endpoint has no time-range or category filters, so those params are ignored.
 */
export class KeirolabsImpl implements SearchServiceImpl {
  // Keirolabs picks its own engines, so retrying without searchEngines would repeat the same billed request
  readonly useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    return process.env.KEIROLABS_API_KEY;
  }

  private get baseUrl(): string {
    return 'https://api.keirolabs.cloud';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Keirolabs query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/api/v2/search/lite');

    // 15 is the most results the lite endpoint returns per request
    const body: KeirolabsSearchParameters = { maxResults: 15, query };

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Keirolabs fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Keirolabs.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Keirolabs request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Keirolabs request failed: ${response.statusText}`,
      });
    }

    try {
      const keirolabsResponse = (await response.json()) as KeirolabsResponse;

      const mappedResults = (keirolabsResponse.results || []).map(
        (result): UniformSearchResult => ({
          category: 'general',
          content: result.snippet || '',
          engines: ['keirolabs'],
          parsedUrl: result.domain || (result.url ? new URL(result.url).hostname : ''),
          score: result.score ?? 1,
          title: result.title || '',
          url: result.url,
        }),
      );

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing Keirolabs response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Keirolabs response.',
      });
    }
  }
}
