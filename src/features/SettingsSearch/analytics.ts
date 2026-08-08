import { uuid } from '@lobechat/utils';
import { useEffect, useMemo, useRef } from 'react';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

import type { SettingsSearchResult } from './useSettingsSearch';

export const SETTINGS_SEARCH_EVENTS = {
  ABANDONED: 'settings_search_abandoned',
  QUERY: 'settings_search_query',
  RESULT_CLICKED: 'settings_search_result_clicked',
} as const;

export const SETTINGS_SEARCH_SPM = {
  ABANDONED: 'settings.search.abandoned',
  QUERY: 'settings.search.query',
  RESULT_CLICKED: 'settings.search.result_clicked',
} as const;

/**
 * A query only counts once the user pauses typing — keystroke-level tracking
 * would record every prefix ("图", "图片") as a separate keyword.
 */
const QUERY_SETTLE_MS = 1000;

/** Cap recorded query length: enough for analysis, avoids logging pasted blobs */
const MAX_QUERY_LENGTH = 100;

/**
 * Secret-looking input must never reach analytics: telemetry is default-on and
 * users may paste an API key into the search box by accident. Real settings
 * queries are short human words, so redact anything that looks like a
 * credential — a known key prefix at any token boundary (covers pastes with
 * surrounding text like `apiKey=sk-...` or JSON snippets), or a long unbroken
 * ASCII token (including base64/JWT punctuation `+ / = .`). This is
 * defense-in-depth for the accidental-paste scenario, not an exhaustive secret
 * scanner — blocklist completeness is a non-goal; users can also disable
 * telemetry entirely.
 */
const TOKEN_LIKE_QUERY = /(?:^|[^\w-])(?:sk-|pk-|ghp_|gho_|xox|akia|bearer\s)|^[\w+/=.-]{16,}$/i;

const REDACTED_QUERY = '[redacted]';

const sanitizeQuery = (query: string) => {
  const normalized = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  return TOKEN_LIKE_QUERY.test(normalized) ? REDACTED_QUERY : normalized;
};

type SettingsSearchResultType = 'connector' | 'item' | 'provider' | 'tab';

/** Result keys are prefixed by their index source: `tab-*` / `item-*` / `provider-*` / `connector-*` */
const getResultType = (resultKey: string): SettingsSearchResultType => {
  if (resultKey.startsWith('item-')) return 'item';
  if (resultKey.startsWith('provider-')) return 'provider';
  if (resultKey.startsWith('connector-')) return 'connector';
  return 'tab';
};

interface SearchSession {
  clicked: boolean;
  id: string;
  lastQuery: string;
  lastResultCount: number;
  /** Number of settled (reported) queries in this session */
  queryCount: number;
}

/**
 * Tracks one search session: mounts with the first non-empty query and ends on
 * unmount (input cleared or user left settings). Emits:
 *
 * - `settings_search_query` — each settled query with its result count. Zero-result
 *   queries reveal missing keywords/synonyms in the search index.
 * - `settings_search_result_clicked` — which result was picked, its type and rank.
 *   Click-through rate and clicked position are the primary satisfaction proxies.
 * - `settings_search_abandoned` — session ended without any click. Combined with
 *   `had_results` this separates "nothing matched" from "results were irrelevant".
 */
export const useSettingsSearchAnalytics = (
  query: string,
  results: SettingsSearchResult[],
  /**
   * While the search index is still loading (pinyin dict), result counts are
   * not authoritative — hold the settle timer so a transient zero-result state
   * is never reported as a missing-keyword signal.
   */
  isIndexing = false,
) => {
  const sessionRef = useRef<SearchSession>({
    clicked: false,
    // Not crypto.randomUUID: it is secure-context-only, and this initializer
    // runs on every render — self-hosted plain-http deployments would crash.
    id: uuid(),
    lastQuery: '',
    lastResultCount: 0,
    queryCount: 0,
  });

  const sanitizedQuery = sanitizeQuery(query);
  // Real length of what the user typed (capped), even when the content is redacted
  const queryLength = Math.min(query.trim().length, MAX_QUERY_LENGTH);
  const resultCount = results.length;

  useEffect(() => {
    if (!sanitizedQuery || isIndexing) return;

    const timer = setTimeout(() => {
      const session = sessionRef.current;
      // Skip repeats (e.g. re-render with the same settled query)
      if (sanitizedQuery === session.lastQuery) return;

      session.queryCount += 1;
      session.lastQuery = sanitizedQuery;
      session.lastResultCount = resultCount;

      trackProductUsageEvent({
        name: SETTINGS_SEARCH_EVENTS.QUERY,
        properties: {
          query: sanitizedQuery,
          query_length: queryLength,
          result_count: resultCount,
          sequence: session.queryCount,
          session_id: session.id,
          spm: SETTINGS_SEARCH_SPM.QUERY,
        },
      });
    }, QUERY_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [sanitizedQuery, queryLength, resultCount, isIndexing]);

  // Session end = component unmount. Report abandonment only when at least one
  // query settled and nothing was ever clicked.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session.clicked || session.queryCount === 0) return;

      trackProductUsageEvent({
        name: SETTINGS_SEARCH_EVENTS.ABANDONED,
        properties: {
          had_results: session.lastResultCount > 0,
          last_query: session.lastQuery,
          last_result_count: session.lastResultCount,
          query_count: session.queryCount,
          session_id: session.id,
          spm: SETTINGS_SEARCH_SPM.ABANDONED,
        },
      });
    },
    [],
  );

  return useMemo(
    () => ({
      trackResultClick: (result: SettingsSearchResult, position: number) => {
        const session = sessionRef.current;
        session.clicked = true;

        trackProductUsageEvent({
          name: SETTINGS_SEARCH_EVENTS.RESULT_CLICKED,
          properties: {
            // The click may land before the settle timer, so report the live
            // query, not the last settled one.
            position,
            query: sanitizeQuery(query),
            query_count: session.queryCount,
            result_count: resultCount,
            result_key: result.key,
            result_type: getResultType(result.key),
            session_id: session.id,
            spm: SETTINGS_SEARCH_SPM.RESULT_CLICKED,
          },
        });
      },
    }),
    [query, resultCount],
  );
};
