import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { type SearchServiceImpl } from '../type';
import {
  type AimlApiToolRunResponse,
  type AimlApiWebSearchInput,
  type AimlApiWebSearchResult,
} from './type';

const log = debug('lobe-search:AimlApi');

/**
 * Fixed endpoint of the AI/ML API Toolbox. The API key is only ever sent to this host;
 * redirects are rejected so the key cannot follow a `Location` to another origin.
 */
export const AIMLAPI_TOOLS_RUN_URL = 'https://tools.aimlapi.com/v1/tools/run';

const MAX_RESULTS = 15;

/**
 * AI/ML API implementation of the search service, backed by the `web/search` tool
 * of the AI/ML API Toolbox (billed per run to the user's AI/ML API account).
 */
export class AimlApiImpl implements SearchServiceImpl {
  // The web/search tool picks its own sources, so retrying without `searchEngines` would
  // repeat the same billed run
  readonly useAutoSearchEngineSelection = true;

  private get apiKey(): string | undefined {
    return process.env.AIMLAPI_API_KEY;
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting AI/ML API query with query: "%s", params: %o', query, params);

    const input: AimlApiWebSearchInput = {
      include_domains: null,
      max_results: MAX_RESULTS,
      query,
    };

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      response = await fetch(AIMLAPI_TOOLS_RUN_URL, {
        body: JSON.stringify({ input, tool: 'web/search' }),
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('AI/ML API fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to AI/ML API.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `AI/ML API request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `AI/ML API request failed: ${response.statusText}`,
      });
    }

    let data: AimlApiToolRunResponse<{ results?: AimlApiWebSearchResult[] }>;
    try {
      data = await response.json();
    } catch (error) {
      log.extend('error')('Error parsing AI/ML API response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse AI/ML API response.',
      });
    }

    if (data.is_error || (data.status && data.status !== 'completed')) {
      throw new TRPCError({
        cause: data.error,
        code: 'SERVICE_UNAVAILABLE',
        message: `AI/ML API web search did not complete: ${data.error?.message || data.status}`,
      });
    }

    const results = (data.output?.results || []).map((result): UniformSearchResult => ({
      category: 'general',
      content: result.snippet || '',
      engines: ['aimlapi'],
      parsedUrl: result.url ? new URL(result.url).hostname : '',
      score: 0,
      title: result.title || '',
      url: result.url,
    }));

    log('Mapped %d results to SearchResult format', results.length);

    return { costTime, query, resultNumbers: results.length, results };
  }
}
