import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type DeepSeekSearchParameters, type DeepSeekSearchResponse } from './type';

const log = debug('lobe-search:DeepSeek');

/**
 * DeepSeek rejects queries longer than this (counted in Unicode characters)
 */
const MAX_QUERY_LENGTH = 128;

const TIME_RANGE_DAYS: Record<string, number> = { day: 1, month: 30, week: 7, year: 365 };

/**
 * DeepSeek has no time-range parameter; it filters by the `after:` query operator instead
 */
const getTimeRangeOperator = (searchTimeRange?: string): string | undefined => {
  const days = searchTimeRange ? TIME_RANGE_DAYS[searchTimeRange] : undefined;
  if (days === undefined) return;

  const after = new Date(Date.now() - days * 86_400 * 1000).toISOString().slice(0, 10);

  return `after:${after}`;
};

/**
 * Build the query sent to DeepSeek: append the time-range operator and truncate the
 * user's query so the whole string stays within the length limit instead of failing with 400
 */
export const buildDeepSeekQuery = (query: string, params: SearchParams = {}): string => {
  const operator = getTimeRangeOperator(params.searchTimeRange);
  const suffix = operator ? ` ${operator}` : '';
  const base = Array.from(query.trim())
    .slice(0, MAX_QUERY_LENGTH - suffix.length)
    .join('')
    .trim();

  return `${base}${suffix}`;
};

/**
 * DeepSeek implementation of the search service
 * @see https://api-docs.deepseek.com/zh-cn/guides/search
 */
export class DeepSeekImpl implements SearchServiceImpl {
  // DeepSeek picks its own sources, so retrying without `searchEngines` would repeat the same request
  readonly useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    // Fall back to the model provider key so a single DeepSeek key enables search too
    return process.env.DEEPSEEK_SEARCH_API_KEY || process.env.DEEPSEEK_API_KEY;
  }

  private get baseUrl(): string {
    return 'https://api.deepseek.com';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log(
      'Starting DeepSeek query (query length: %d, timeRange: %s)',
      query.length,
      params.searchTimeRange,
    );
    const endpoint = urlJoin(this.baseUrl, '/v1/tools/search');

    const body: DeepSeekSearchParameters = {
      count: 10,
      need_content: false,
      query: buildDeepSeekQuery(query, params),
    };

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
      log.extend('error')('DeepSeek fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to DeepSeek.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `DeepSeek request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `DeepSeek request failed: ${response.statusText}`,
      });
    }

    try {
      const deepseekResponse = (await response.json()) as DeepSeekSearchResponse;

      const mappedResults = (deepseekResponse.results || []).map((result): UniformSearchResult => ({
        category: 'general',
        // `summary` is the longer excerpt DeepSeek prepares for model reading
        content: result.summary || result.snippet || '',
        engines: ['deepseek'],
        parsedUrl: result.url ? new URL(result.url).hostname : '',
        publishedDate: result.date || undefined,
        score: result.rerank_score || 0,
        title: result.title || '',
        url: result.url,
      }));

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing DeepSeek response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse DeepSeek response.',
      });
    }
  }
}
