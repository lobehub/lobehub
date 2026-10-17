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

export class DeepSeekImpl implements SearchServiceImpl {
  useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    return process.env.DEEPSEEK_SEARCH_API_KEY;
  }

  private get baseUrl(): string {
    return process.env.DEEPSEEK_SEARCH_API_URL || 'https://api.deepseek.com';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting DeepSeek query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/v1/tools/search');

    let formattedQuery = query.trim();
    if (
      params?.searchTimeRange &&
      params.searchTimeRange !== 'anytime' &&
      !formattedQuery.includes('after:')
    ) {
      const days = { day: 1, month: 30, week: 7, year: 365 }[params.searchTimeRange];
      if (days !== undefined) {
        const afterDate = new Date(Date.now() - days * 86_400 * 1000).toISOString().split('T')[0];
        const afterSuffix = ` after:${afterDate}`;
        const maxQueryLen = Math.max(0, 128 - afterSuffix.length);
        formattedQuery = `${formattedQuery.slice(0, maxQueryLen).trim()}${afterSuffix}`;
      }
    }

    if (formattedQuery.length > 128) {
      formattedQuery = formattedQuery.slice(0, 128);
    }

    const body: DeepSeekSearchParameters = {
      count: 10,
      need_content: false,
      query: formattedQuery,
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
      log.extend('error')('DeepSeek fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to DeepSeek search service.',
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
        message: `DeepSeek search request failed: ${response.statusText}`,
      });
    }

    try {
      const deepseekResponse = (await response.json()) as DeepSeekSearchResponse;

      log('Parsed DeepSeek response: %o', deepseekResponse);

      const mappedResults = (deepseekResponse.results || []).map((result): UniformSearchResult => ({
        category: 'general',
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
