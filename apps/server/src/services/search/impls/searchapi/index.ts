import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type SearchApiResponse, type SearchApiResultItem, type SearchApiTimePeriod } from './type';

const log = debug('lobe-search:SearchApi');

const timePeriodMapping: Record<string, SearchApiTimePeriod | undefined> = {
  day: 'last_day',
  month: 'last_month',
  week: 'last_week',
  year: 'last_year',
};

/**
 * SearchApi serves every engine from one endpoint and returns a different array per engine,
 * so the array to read depends on the engine that answered the query.
 */
const RESULT_ARRAYS = ['organic_results', 'videos', 'shopping_results', 'jobs'] as const;

const pickResults = (response: SearchApiResponse): SearchApiResultItem[] => {
  for (const key of RESULT_ARRAYS) {
    const items = response[key];
    if (items && items.length > 0) return items;
  }

  return [];
};

const parseHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * SearchApi implementation of the search service
 * Primarily used for web crawling
 */
export class SearchAPIImpl implements SearchServiceImpl {
  /**
   * SearchApi picks the engine for the query, so an explicit engine restriction from the
   * caller is dropped rather than forwarded.
   */
  readonly useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    return process.env.SEARCHAPI_API_KEY;
  }

  private get baseUrl(): string {
    return 'https://www.searchapi.io/api/v1';
  }

  /**
   * Engine for this query: an explicit `SEARCHAPI_ENGINE` wins, then a news request, then
   * the plain web engine.
   */
  private resolveEngine(params: SearchParams = {}): string {
    if (process.env.SEARCHAPI_ENGINE) return process.env.SEARCHAPI_ENGINE;

    return params.searchCategories?.includes('news') ? 'google_news' : 'google';
  }

  private buildEndpoint(query: string, engine: string, params: SearchParams = {}): string {
    const endpoint = new URL(urlJoin(this.baseUrl, '/search'));

    endpoint.searchParams.set('engine', engine);
    endpoint.searchParams.set('q', query);

    // SearchApi reads the key from the `api_key` query parameter.
    if (this.apiKey) {
      endpoint.searchParams.set('api_key', this.apiKey);
    }

    const timePeriod =
      params.searchTimeRange && params.searchTimeRange !== 'anytime'
        ? timePeriodMapping[params.searchTimeRange]
        : undefined;

    if (timePeriod) {
      endpoint.searchParams.set('time_period', timePeriod);
    }

    return endpoint.toString();
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting SearchApi query with query: "%s", params: %o', query, params);

    const engine = this.resolveEngine(params);
    const endpoint = this.buildEndpoint(query, engine, params);
    const category = engine === 'google_news' ? 'news' : 'general';

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'GET',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('SearchApi fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to SearchApi.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `SearchApi request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `SearchApi request failed: ${response.statusText}`,
      });
    }

    let searchApiResponse: SearchApiResponse;
    try {
      searchApiResponse = (await response.json()) as SearchApiResponse;
      log('Parsed SearchApi response: %o', searchApiResponse);
    } catch (error) {
      log.extend('error')('Error parsing SearchApi response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse SearchApi response.',
      });
    }

    // SearchApi reports some failures in the body instead of with a failing status code.
    if (searchApiResponse.error) {
      log.extend('error')('SearchApi returned an error: %s', searchApiResponse.error);
      throw new TRPCError({
        cause: searchApiResponse.error,
        code: 'SERVICE_UNAVAILABLE',
        message: `SearchApi request failed: ${searchApiResponse.error}`,
      });
    }

    const mappedResults = pickResults(searchApiResponse).map(
      (result): UniformSearchResult => ({
        category,
        content: result.snippet || result.description || result.content || '',
        engines: [engine],
        parsedUrl: parseHostname(result.link),
        publishedDate: result.date || result.published_date,
        // SearchApi orders results by position and returns no relevance score.
        score: 0,
        thumbnail: result.thumbnail,
        title: result.title || '',
        url: result.link,
      }),
    );

    log('Mapped %d results to SearchResult format', mappedResults.length);

    return {
      costTime,
      query,
      resultNumbers: mappedResults.length,
      results: mappedResults,
    };
  }
}
