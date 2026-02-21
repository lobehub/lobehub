import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type JinaResponse, type JinaSearchParameters } from './type';

const log = debug('lobe-search:Jina');

/**
 * Jina implementation of the search service
 * Primarily used for web crawling
 */
export class JinaImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.JINA_READER_API_KEY || process.env.JINA_API_KEY;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://s.jina.ai';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Jina query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/');

    const body: JinaSearchParameters = {
      q: query,
    };

    log('Constructed request body: %o', body);

    let response: Response;
    const startAt = Date.now();
    let costTime = 0;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: {
          'Accept': 'application/json',
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
          'X-Respond-With': 'no-content',
        },
        method: 'POST',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Jina fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Jina.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Jina request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Jina request failed: ${response.statusText}`,
      });
    }

    try {
      const jinaResponse = (await response.json()) as JinaResponse;

      log('Parsed Jina response: %o', jinaResponse);

      const mappedResults = (jinaResponse.data || []).map(
        (result): UniformSearchResult => ({
          category: 'general', // Default category
          content: result.description || '', // Prioritize content, fallback to snippet
          engines: ['jina'], // Use 'jina' as the engine name
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
      log.extend('error')('Error parsing Jina response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Jina response.',
      });
    }
  }
}
