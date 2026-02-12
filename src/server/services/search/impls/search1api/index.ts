import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type Search1ApiResponse } from './type';

interface Search1APIQueryParams {
  crawl_results?: 0 | 1;
  exclude_sites?: string[];
  image?: boolean;
  include_sites?: string[];
  language?: string;
  max_results: number;
  query: string;
  search_service?: string;
  time_range?: string;
}

const log = debug('lobe-search:search1api');

/**
 * Search1API implementation of the search service
 * Primarily used for web crawling
 */
export class Search1APIImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.SEARCH1API_SEARCH_API_KEY || process.env.SEARCH1API_API_KEY;
  }

  private get baseUrl(): string {
    // Assuming the base URL is consistent with the crawl endpoint
    return 'https://api.search1api.com';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Search1API query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/search');

    const { searchEngines } = params;

    const defaultQueryParams: Search1APIQueryParams = {
      crawl_results: 0, // Default is no crawling
      image: false,
      max_results: 15, // Default max results
      query,
    };

    let body: Search1APIQueryParams[] = [
      {
        ...defaultQueryParams,
        time_range:
          params?.searchTimeRange && params.searchTimeRange !== 'anytime'
            ? params.searchTimeRange
            : undefined,
      },
    ];

    if (searchEngines && searchEngines.length > 0) {
      body = searchEngines.map((searchEngine) => ({
        ...defaultQueryParams,

        max_results: parseInt((20 / searchEngines.length).toFixed(0)),
        search_service: searchEngine,
        time_range:
          params?.searchTimeRange && params.searchTimeRange !== 'anytime'
            ? params.searchTimeRange
            : undefined,
      }));
    }

    // Note: Other SearchParams like searchCategories, searchEngines (beyond the first one)
    // and Search1API specific params like include_sites, exclude_sites, language
    // are not currently mapped.

    log('Constructed request body: %o', body);

    let response: Response;
    const startAt = Date.now();
    let costTime = 0;
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
      log.extend('error')('Search1API fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Search1API.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Search1API request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Search1API request failed: ${response.statusText}`,
      });
    }

    try {
      const search1ApiResponse = (await response.json()) as Search1ApiResponse[]; // Use a specific type if defined elsewhere

      log('Parsed Search1API response: %o', search1ApiResponse);

      const mappedResults = search1ApiResponse.flatMap((response) => {
        // Map Search1API response to SearchResponse
        return (response.results || []).map(
          (result): UniformSearchResult => ({
            category: 'general', // Default category
            content: result.content || result.snippet || '', // Prioritize content, fallback to snippet
            engines: [response.searchParameters?.search_service || ''],
            parsedUrl: result.link ? new URL(result.link).hostname : '', // Basic URL parsing
            score: 1, // Default score
            title: result.title || '',
            url: result.link,
          }),
        );
      });

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query: query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing Search1API response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Search1API response.',
      });
    }
  }
}
