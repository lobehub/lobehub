import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type SpecStreamSearchResponse } from './type';

const log = debug('lobe-search:SpecStream');

/**
 * The API rejects questions longer than this (counted in Unicode characters)
 */
const MAX_QUERY_LENGTH = 2000;

const safeHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * SpecStream implementation of the search service
 * @see https://specstream.ai/search-api
 */
export class SpecStreamImpl implements SearchServiceImpl {
  // SpecStream picks its own sources, so retrying without `searchEngines` would repeat the same request
  readonly useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    return process.env.SPECSTREAM_API_KEY;
  }

  private get baseUrl(): string {
    return 'https://api.specstream.ai';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log(
      'Starting SpecStream query (query length: %d, timeRange: %s)',
      query.length,
      params.searchTimeRange,
    );
    const endpoint = urlJoin(this.baseUrl, '/v1/web-search');

    const searchParams = new URLSearchParams({
      // `passages` adds the text of the top pages, so each result carries more than a snippet
      passages: 'true',
      q: Array.from(query.trim()).slice(0, MAX_QUERY_LENGTH).join(''),
    });

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(`${endpoint}?${searchParams.toString()}`, {
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('SpecStream fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to SpecStream.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `SpecStream request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `SpecStream request failed: ${response.statusText}`,
      });
    }

    try {
      const payload = (await response.json()) as SpecStreamSearchResponse;
      const sources = payload.data?.sources || [];
      const passageByUrl = new Map(
        (payload.data?.passages || []).map((passage) => [passage.url, passage.text]),
      );

      const mappedResults = sources.map((source, index): UniformSearchResult => ({
        category: 'general',
        content: passageByUrl.get(source.url) || source.snippet || '',
        engines: ['specstream'],
        parsedUrl: safeHostname(source.url),
        publishedDate: source.published || undefined,
        // The API returns results in rank order without a score, so keep the order as a score
        score: sources.length > 0 ? 1 - index / sources.length : 0,
        title: source.title || '',
        url: source.url,
      }));

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing SpecStream response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse SpecStream response.',
      });
    }
  }
}
