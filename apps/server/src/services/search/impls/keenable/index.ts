import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import { type SearchServiceImpl } from '../type';
import { type KeenableResponse, type KeenableSearchParameters } from './type';

const log = debug('lobe-search:Keenable');

const DEFAULT_BASE_URL = 'https://api.keenable.ai';

/**
 * Keenable returns whole-page text where the other providers return a short
 * snippet, so cap it to keep `content` the same size as theirs.
 */
const MAX_CONTENT_CHARS = 500;

/**
 * Picks a result's text.
 *
 * Keenable returns both `snippet` and `description`: `snippet` carries the page
 * text and `description` is frequently empty, so prefer whichever has content.
 * Snippets are raw page text with newlines in them, hence the whitespace
 * collapse and the cap.
 */
const resultContent = (result: { description?: string; snippet?: string }): string =>
  (result.snippet || result.description || '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_CONTENT_CHARS);

/**
 * How far back each `searchTimeRange` reaches, in days. Same mapping as the
 * Exa and Anspire impls.
 */
const TIME_RANGE_DAYS: Record<string, number> = { day: 1, month: 30, week: 7, year: 365 };

/**
 * Maps `searchTimeRange` to Keenable's `published_after`, a `YYYY-MM-DD` date.
 * `anytime` and unknown values add no filter. Keenable keeps pages that carry
 * no publish date, so the filter only drops pages dated before the cutoff.
 */
const publishedAfter = (searchTimeRange?: string): string | undefined => {
  if (!searchTimeRange || !Object.hasOwn(TIME_RANGE_DAYS, searchTimeRange)) return undefined;

  const days = TIME_RANGE_DAYS[searchTimeRange];

  return new Date(Date.now() - days * 86_400 * 1000).toISOString().slice(0, 10);
};

/**
 * Keenable implementation of the search service.
 *
 * Keenable is a web search API built for AI agents. Unlike the other providers,
 * it works without an API key by default (keyless public endpoint); setting
 * `KEENABLE_API_KEY` uses the authenticated endpoint and lifts rate limits.
 */
export class KeenableImpl implements SearchServiceImpl {
  private get apiKey(): string | undefined {
    return process.env.KEENABLE_API_KEY?.trim() || undefined;
  }

  private get baseUrl(): string {
    return (process.env.KEENABLE_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Keenable query with query: "%s", params: %o', query, params);

    // Keyless public endpoint by default; the keyed endpoint when a key is set.
    const path = this.apiKey ? '/v1/search' : '/v1/search/public';
    const endpoint = urlJoin(this.baseUrl, path);

    const after = publishedAfter(params?.searchTimeRange);
    const body: KeenableSearchParameters = {
      mode: 'pro',
      query,
      ...(after ? { published_after: after } : {}),
    };

    log('Constructed request body: %o', body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Attribution header the Keenable backend segments traffic by.
      'User-Agent': 'keenable-lobechat',
      'X-Keenable-Title': 'LobeChat',
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    let response: Response;
    const startAt = Date.now();
    let costTime: number;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers,
        method: 'POST',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('Keenable fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Keenable.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `Keenable request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `Keenable request failed: ${response.statusText}`,
      });
    }

    try {
      const keenableResponse = (await response.json()) as KeenableResponse;

      log('Parsed Keenable response: %o', keenableResponse);

      const mappedResults = (keenableResponse.results || []).map(
        (result): UniformSearchResult => ({
          category: 'general',
          content: resultContent(result),
          engines: ['keenable'],
          parsedUrl: result.url ? new URL(result.url).hostname : '',
          publishedDate: result.published_at || undefined,
          score: 1,
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
      log.extend('error')('Error parsing Keenable response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Keenable response.',
      });
    }
  }
}
