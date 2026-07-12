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

type SettingsSearchResultType = 'item' | 'provider' | 'tab';

/** Result keys are prefixed by their index source: `tab-*` / `item-*` / `provider-*` */
const getResultType = (resultKey: string): SettingsSearchResultType => {
  if (resultKey.startsWith('item-')) return 'item';
  if (resultKey.startsWith('provider-')) return 'provider';
  return 'tab';
};

const normalizeQuery = (query: string) => query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);

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
export const useSettingsSearchAnalytics = (query: string, results: SettingsSearchResult[]) => {
  const sessionRef = useRef<SearchSession>({
    clicked: false,
    id: Math.random().toString(36).slice(2, 10),
    lastQuery: '',
    lastResultCount: 0,
    queryCount: 0,
  });

  const normalizedQuery = normalizeQuery(query);
  const resultCount = results.length;

  useEffect(() => {
    if (!normalizedQuery) return;

    const timer = setTimeout(() => {
      const session = sessionRef.current;
      // Skip repeats (e.g. re-render with the same settled query)
      if (normalizedQuery === session.lastQuery) return;

      session.queryCount += 1;
      session.lastQuery = normalizedQuery;
      session.lastResultCount = resultCount;

      trackProductUsageEvent({
        name: SETTINGS_SEARCH_EVENTS.QUERY,
        properties: {
          query: normalizedQuery,
          query_length: normalizedQuery.length,
          result_count: resultCount,
          sequence: session.queryCount,
          session_id: session.id,
          spm: SETTINGS_SEARCH_SPM.QUERY,
        },
      });
    }, QUERY_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [normalizedQuery, resultCount]);

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
            query: normalizeQuery(query),
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
