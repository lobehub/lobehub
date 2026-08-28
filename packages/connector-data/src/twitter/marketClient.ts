import { toRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { ConnectorDataError, getConnectorErrorMessage } from '../errors';
import { withConnectorRetry } from '../retry';
import { parseTwitterPosts, parseTwitterProfile } from './parser';
import type { TwitterConnectorClient } from './types';

const DEFAULT_MAX_RESULTS = 25;
const MAX_QUERY_LENGTH = 512;
const PROFILE_TOOL_NAME = 'get_me';
const RECENT_SEARCH_TOOL_NAME = 'search_tweets';
const log = debug('lobe-server:connector-data:twitter');

interface TwitterMarketToolFailure {
  message: string;
  statusCode?: number;
}

/** Result returned by one Market X tool execution. */
export interface TwitterMarketToolResult {
  /** Provider response payload, when execution reached the provider. */
  data?: unknown;
  /** Whether Market accepted and completed the tool invocation. */
  success: boolean;
}

/** Minimal Market tool executor required by the read-only X connector. */
export interface TwitterMarketToolExecutor {
  /** Executes one tool against the current user's Market X connection. */
  callTool: (
    toolName: string,
    arguments_: Record<string, unknown>,
  ) => Promise<TwitterMarketToolResult>;
}

/** Options for creating a Market-backed X connector client. */
export interface CreateTwitterMarketConnectorClientOptions {
  /** User-scoped Market tool executor authenticated through Trusted Client or OAuth. */
  market: TwitterMarketToolExecutor;
}

/**
 * Extracts the original diagnostic from an embedded Market X tool error.
 */
const readEmbeddedToolFailure = (value: unknown): TwitterMarketToolFailure | undefined => {
  const record = toRecord(value);
  if (!record) return;
  const statusCode =
    typeof record.statusCode === 'number' && Number.isFinite(record.statusCode)
      ? record.statusCode
      : undefined;
  if (record.isError !== true && (statusCode === undefined || statusCode < 400)) return;

  const message = getConnectorErrorMessage(record.error) ?? getConnectorErrorMessage(value);
  if (!message) return;

  return { message, ...(statusCode === undefined ? {} : { statusCode }) };
};

/**
 * Creates a bounded, read-only X client over LobeHub Market tools.
 *
 * Use when:
 * - Understanding should reuse the user's existing LobeHub Market X authorization
 * - Background workflows need X evidence through Trusted Client authentication
 *
 * Expects:
 * - `market` executes tools for an already-connected `twitter` provider
 * - Tool responses follow the Market skill result contract
 *
 * Returns:
 * - A client that normalizes Market response variants and retains provider failure messages
 */
export const createTwitterMarketConnectorClient = ({
  market,
}: CreateTwitterMarketConnectorClientOptions): TwitterConnectorClient => {
  const execute = async (
    toolName: string,
    operation: string,
    arguments_: Record<string, unknown>,
  ) =>
    withConnectorRetry(async () => {
      const response = await market.callTool(toolName, arguments_);
      const failure = readEmbeddedToolFailure(response.data);
      if (response.success !== true || failure) {
        log('Market X tool call failed: %O', {
          message: failure?.message ?? getConnectorErrorMessage(response),
          operation,
          ...(failure?.statusCode === undefined ? {} : { statusCode: failure.statusCode }),
          toolName,
        });
        throw new ConnectorDataError({
          cause: response,
          code: `twitter_${operation}_failed`,
          message: failure?.message ?? getConnectorErrorMessage(response),
          operation,
          provider: 'twitter',
          retryable: false,
        });
      }
      return response.data;
    });

  return {
    getProfile: async () => {
      const response = await execute(PROFILE_TOOL_NAME, 'getProfile', {
        userFields: [
          'created_at',
          'description',
          'location',
          'pinned_tweet_id',
          'profile_image_url',
          'public_metrics',
          'url',
          'verified',
        ],
      });
      const profile = parseTwitterProfile(response);
      if (!profile) {
        throw new ConnectorDataError({
          cause: response,
          code: 'twitter_response_invalid',
          message: getConnectorErrorMessage(response),
          operation: 'getProfile',
          provider: 'twitter',
          retryable: false,
        });
      }
      return profile;
    },
    searchRecentPosts: async ({ maxResults = DEFAULT_MAX_RESULTS, query }) => {
      const normalizedQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (!normalizedQuery) {
        throw new ConnectorDataError({
          code: 'twitter_query_invalid',
          operation: 'searchRecentPosts',
          provider: 'twitter',
          retryable: false,
        });
      }
      const finiteMaxResults = Number.isFinite(maxResults) ? maxResults : DEFAULT_MAX_RESULTS;
      // X recent search accepts 10-100 results per request; clamp before calling Market.
      const boundedMaxResults = Math.min(Math.max(10, Math.floor(finiteMaxResults)), 100);
      const response = await execute(RECENT_SEARCH_TOOL_NAME, 'searchRecentPosts', {
        expansions: ['author_id'],
        maxResults: boundedMaxResults,
        query: normalizedQuery,
        sortOrder: 'recency',
        tweetFields: [
          'author_id',
          'conversation_id',
          'created_at',
          'in_reply_to_user_id',
          'public_metrics',
          'referenced_tweets',
        ],
        userFields: ['username'],
      });
      const posts = parseTwitterPosts(response, boundedMaxResults);
      if (!posts) {
        throw new ConnectorDataError({
          cause: response,
          code: 'twitter_response_invalid',
          message: getConnectorErrorMessage(response),
          operation: 'searchRecentPosts',
          provider: 'twitter',
          retryable: false,
        });
      }
      return posts;
    },
  };
};
