import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type CrwResponse, type CrwSearchParameters } from './type';

const log = debug('lobe-search:Crw');

const timeRangeMapping = {
  day: 'qdr:d',
  month: 'qdr:m',
  week: 'qdr:w',
  year: 'qdr:y',
};

/**
 * fastCRW implementation of the search service.
 * fastCRW is a Firecrawl-compatible web data engine (single binary; self-host or cloud).
 * This mirrors the Firecrawl impl, defaulting to the managed cloud base URL.
 */
export class CrwImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.CRW_API_KEY;
  }

  private get baseUrl(): string {
    // Default to the managed cloud; allow overriding the base URL for self-host.
    return process.env.CRW_URL || 'https://fastcrw.com/api';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting fastCRW query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/v1/search');

    const defaultQueryParams: CrwSearchParameters = {
      limit: 20,
      query,
      /*
      scrapeOptions: {
        formats: ["markdown"]
      },
      */
      sources: [{ type: 'web' }, { type: 'news' }],
    };

    const body: CrwSearchParameters = {
      ...defaultQueryParams,
      tbs:
        params?.searchTimeRange && params.searchTimeRange !== 'anytime'
          ? (timeRangeMapping[params.searchTimeRange as keyof typeof timeRangeMapping] ?? undefined)
          : undefined,
    };

    log('Constructed request body: %o', body);

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      log('Sending request to endpoint: %s', endpoint);
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
      log.extend('error')('fastCRW fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to fastCRW.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `fastCRW request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `fastCRW request failed: ${response.statusText}`,
      });
    }

    try {
      const crwResponse = (await response.json()) as CrwResponse;

      log('Parsed fastCRW response: %o', crwResponse);

      // Response returns data as object with web/images/news arrays
      const webResults = crwResponse.data.web || [];
      const imageResults = crwResponse.data.images || [];
      const newsResults = crwResponse.data.news || [];

      // Map web results
      const mappedWebResults = webResults.map(
        (result): UniformSearchResult => ({
          category: 'general',
          content: result.description || result.markdown || '',
          engines: ['crw'],
          parsedUrl: result.url ? new URL(result.url).hostname : '',
          score: 1,
          title: result.title || '',
          url: result.url,
        }),
      );

      // Map news results
      const mappedNewsResults = newsResults.map(
        (result): UniformSearchResult => ({
          category: 'news',
          content: result.snippet || result.markdown || '',
          engines: ['crw'],
          parsedUrl: result.url ? new URL(result.url).hostname : '',
          score: 1,
          title: result.title || '',
          url: result.url,
        }),
      );

      // Map image results
      const mappedImageResults = imageResults.map(
        (result): UniformSearchResult => ({
          category: 'images',
          content: result.title || '',
          engines: ['crw'],
          parsedUrl: result.url ? new URL(result.url).hostname : '',
          score: 1,
          title: result.title || '',
          url: result.imageUrl, // Use imageUrl for images
        }),
      );

      // Combine all results
      const allResults = [...mappedWebResults, ...mappedNewsResults, ...mappedImageResults];

      log('Mapped %d results to SearchResult format', allResults.length);

      if (crwResponse.warning) {
        log.extend('warn')('fastCRW warning: %s', crwResponse.warning);
      }

      return {
        costTime,
        query,
        resultNumbers: allResults.length,
        results: allResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing fastCRW response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse fastCRW response.',
      });
    }
  }
}
