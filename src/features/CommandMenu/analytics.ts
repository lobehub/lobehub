import { uuid } from '@lobechat/utils';
import { useCallback, useEffect, useRef } from 'react';

import { isDesktop } from '@/const/version';
import { useSingleton } from '@/hooks/useSingleton';
import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

export interface CommandMenuAnalyticsInput {
  enabled: boolean;
  hasError: boolean;
  hasResponse: boolean;
  isValidating: boolean;
  menuContext: string;
  resultCount: number;
  searchQuery: string;
  typeFilter?: string;
}

export interface CommandMenuResultClick {
  position: number;
  resultType: string;
}

export const GLOBAL_SEARCH_EVENTS = {
  ABANDONED: 'search_abandoned',
  OPENED: 'search_opened',
  QUERY_SETTLED: 'search_query_settled',
  REFINED: 'search_refined',
  RESULTS_RENDERED: 'search_results_rendered',
  RESULT_CLICKED: 'search_result_clicked',
} as const;

const GLOBAL_SEARCH_SPM = {
  ABANDONED: 'command_menu.search.abandoned',
  OPENED: 'command_menu.search.opened',
  QUERY_SETTLED: 'command_menu.search.query_settled',
  REFINED: 'command_menu.search.refined',
  RESULTS_RENDERED: 'command_menu.search.results_rendered',
  RESULT_CLICKED: 'command_menu.search.result_clicked',
} as const;

type SearchStatus = 'empty' | 'error' | 'pending' | 'success';
type RefinementType = 'filter' | 'query';

interface CompletedQuery {
  durationMs: number;
  renderedAt: number;
  resultCount: number;
  status: Exclude<SearchStatus, 'pending'>;
}

interface ActiveQuery {
  clicked: boolean;
  completed?: CompletedQuery;
  inputRevision: number;
  key: string;
  refinementType: RefinementType;
  sequence: number;
  startedAt: number;
  wasHidden: boolean;
}

interface LatestInput {
  length: number;
  refinementType: RefinementType;
  revision: number;
  startedAt: number;
}

interface SearchSession {
  active?: ActiveQuery;
  cleared: boolean;
  clicked: boolean;
  id: string;
  lastCompleted?: CompletedQuery;
  queryCount: number;
}

const bucketQueryLength = (length: number) => {
  if (length <= 2) return '1-2';
  if (length <= 5) return '3-5';
  if (length <= 10) return '6-10';
  if (length <= 20) return '11-20';
  if (length <= 50) return '21-50';
  return '51+';
};

const bucketResultCount = (count: number) => {
  if (count === 0) return '0';
  if (count <= 5) return '1-5';
  if (count <= 10) return '6-10';
  if (count <= 25) return '11-25';
  if (count <= 50) return '26-50';
  return '51+';
};

const bucketPosition = (position: number) => {
  if (position <= 1) return '1';
  if (position <= 3) return '2-3';
  if (position <= 5) return '4-5';
  if (position <= 10) return '6-10';
  return '11+';
};

const bucketDuration = (durationMs: number) => {
  if (durationMs <= 1000) return 'under_1s';
  if (durationMs <= 3000) return '1s-3s';
  if (durationMs <= 5000) return '3s-5s';
  if (durationMs <= 10_000) return '5s-10s';
  return 'over_10s';
};

const bucketClickDecision = (durationMs: number) => {
  if (durationMs <= 2000) return 'under_2s';
  if (durationMs <= 5000) return '2s-5s';
  if (durationMs <= 15_000) return '5s-15s';
  if (durationMs <= 60_000) return '15s-60s';
  return 'over_60s';
};

const now = () => performance.now();

/**
 * Product analytics for one command-menu lifetime. Query text and result
 * identifiers are used by the UI only and are never copied into event properties.
 */
export const useCommandMenuAnalytics = ({
  enabled,
  hasError,
  hasResponse,
  isValidating,
  menuContext,
  resultCount,
  searchQuery,
  typeFilter,
}: CommandMenuAnalyticsInput) => {
  const mountedAt = useSingleton(now);
  const initialMenuContext = useRef(menuContext);
  const latestInputRef = useRef<LatestInput>({
    length: 0,
    refinementType: 'query',
    revision: 0,
    startedAt: mountedAt,
  });
  const openedRef = useRef(false);
  const sessionId = useSingleton(() => uuid());
  const sessionRef = useRef<SearchSession>({
    clicked: false,
    cleared: false,
    id: sessionId,
    queryCount: 0,
  });
  const platform = isDesktop ? 'desktop' : 'web';
  const queryKey = searchQuery ? `${searchQuery}\u0000${typeFilter ?? 'all'}` : '';

  useEffect(() => {
    if (!enabled || openedRef.current) return;
    openedRef.current = true;
    trackProductUsageEvent({
      name: GLOBAL_SEARCH_EVENTS.OPENED,
      properties: {
        menu_context: initialMenuContext.current,
        platform,
        search_session_id: sessionRef.current.id,
        spm: GLOBAL_SEARCH_SPM.OPENED,
        surface: 'command_menu',
      },
    });
  }, [enabled, platform]);

  useEffect(() => {
    const markBackgrounded = () => {
      if (document.visibilityState === 'visible') return;
      const active = sessionRef.current.active;
      if (active) active.wasHidden = true;
    };

    document.addEventListener('visibilitychange', markBackgrounded);
    return () => document.removeEventListener('visibilitychange', markBackgrounded);
  }, []);

  useEffect(() => {
    if (!enabled) {
      sessionRef.current.active = undefined;
      return;
    }

    // Clearing the input does not start a new search, but abandonment still needs the last
    // issued query rather than an earlier completed result. Once the debounced query is empty,
    // typing the same query again is a distinct request and must get a new sequence.
    if (!queryKey) {
      sessionRef.current.cleared = true;
      return;
    }

    const session = sessionRef.current;
    if (session.active?.key === queryKey && !session.cleared) return;

    const previous = session.active;
    if (previous && !previous.clicked) {
      trackProductUsageEvent({
        name: GLOBAL_SEARCH_EVENTS.REFINED,
        properties: {
          platform,
          previous_result_count_bucket: bucketResultCount(previous.completed?.resultCount ?? 0),
          previous_status: previous.completed?.status ?? 'pending',
          refinement_type: latestInputRef.current.refinementType,
          search_session_id: session.id,
          spm: GLOBAL_SEARCH_SPM.REFINED,
          surface: 'command_menu',
        },
      });
    }

    session.queryCount += 1;
    session.cleared = false;
    session.active = {
      clicked: false,
      inputRevision: latestInputRef.current.revision,
      key: queryKey,
      refinementType: latestInputRef.current.refinementType,
      sequence: session.queryCount,
      startedAt: latestInputRef.current.startedAt,
      wasHidden: document.visibilityState !== 'visible',
    };

    trackProductUsageEvent({
      name: GLOBAL_SEARCH_EVENTS.QUERY_SETTLED,
      properties: {
        is_refinement: session.queryCount > 1,
        menu_context: menuContext,
        platform,
        query_length_bucket: bucketQueryLength(latestInputRef.current.length || searchQuery.length),
        refinement_type: latestInputRef.current.refinementType,
        search_session_id: session.id,
        sequence: session.queryCount,
        spm: GLOBAL_SEARCH_SPM.QUERY_SETTLED,
        surface: 'command_menu',
        type_filter: typeFilter ?? 'all',
      },
    });
  }, [enabled, menuContext, platform, queryKey, searchQuery.length, typeFilter]);

  useEffect(() => {
    const active = sessionRef.current.active;
    if (
      !enabled ||
      !active ||
      active.key !== queryKey ||
      active.completed ||
      active.inputRevision !== latestInputRef.current.revision ||
      isValidating ||
      (!hasResponse && !hasError)
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const current = sessionRef.current.active;
      if (
        current !== active ||
        active.inputRevision !== latestInputRef.current.revision ||
        active.completed
      ) {
        return;
      }

      const renderedAt = now();
      const durationMs = Math.max(0, Math.round(renderedAt - active.startedAt));
      const status = hasError ? 'error' : resultCount === 0 ? 'empty' : 'success';
      const completed: CompletedQuery = { durationMs, renderedAt, resultCount, status };
      active.completed = completed;
      sessionRef.current.lastCompleted = completed;

      trackProductUsageEvent({
        name: GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED,
        properties: {
          duration_bucket: bucketDuration(durationMs),
          duration_ms: durationMs,
          menu_context: menuContext,
          platform,
          refinement_type: active.refinementType,
          result_count_bucket: bucketResultCount(resultCount),
          search_session_id: sessionRef.current.id,
          sequence: active.sequence,
          spm: GLOBAL_SEARCH_SPM.RESULTS_RENDERED,
          status,
          surface: 'command_menu',
          type_filter: typeFilter ?? 'all',
          visibility_state: active.wasHidden ? 'backgrounded' : 'foreground',
        },
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [
    enabled,
    hasError,
    hasResponse,
    isValidating,
    menuContext,
    platform,
    queryKey,
    resultCount,
    typeFilter,
  ]);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session.clicked || session.queryCount === 0) return;

      const last = session.active ? session.active.completed : session.lastCompleted;
      trackProductUsageEvent({
        name: GLOBAL_SEARCH_EVENTS.ABANDONED,
        properties: {
          last_result_count_bucket: bucketResultCount(last?.resultCount ?? 0),
          last_status: last?.status ?? 'pending',
          platform,
          query_count: session.queryCount,
          search_session_id: session.id,
          spm: GLOBAL_SEARCH_SPM.ABANDONED,
          surface: 'command_menu',
        },
      });
    },
    [platform],
  );

  const trackInputChange = useCallback(
    (value: string) => {
      const normalizedQuery = value.trim();
      const active = sessionRef.current.active;
      const nextKey = normalizedQuery ? `${normalizedQuery}\u0000${typeFilter ?? 'all'}` : '';

      // Whitespace-only edits and quick edits reverted before the debounce fires do not issue a
      // new request. Keep the active revision so the eventual response is still observable.
      if (active?.key === nextKey && !sessionRef.current.cleared) {
        latestInputRef.current = {
          length: normalizedQuery.length,
          refinementType: 'query',
          revision: active.inputRevision,
          startedAt: active.startedAt,
        };
        return;
      }

      latestInputRef.current = {
        length: normalizedQuery.length,
        refinementType: 'query',
        revision: latestInputRef.current.revision + 1,
        startedAt: now(),
      };
    },
    [typeFilter],
  );

  const trackFilterChange = useCallback(() => {
    latestInputRef.current = {
      length: searchQuery.length,
      refinementType: 'filter',
      revision: latestInputRef.current.revision + 1,
      startedAt: now(),
    };
  }, [searchQuery.length]);

  const trackResultClick = useCallback(
    ({ position, resultType }: CommandMenuResultClick) => {
      if (!enabled) return;
      const session = sessionRef.current;
      const active = session.active;
      if (!active) return;

      active.clicked = true;
      session.clicked = true;
      const clickedAt = now();
      const inputToClickMs = Math.max(0, Math.round(clickedAt - active.startedAt));
      const renderToClickMs = active.completed
        ? Math.max(0, Math.round(clickedAt - active.completed.renderedAt))
        : undefined;

      trackProductUsageEvent({
        name: GLOBAL_SEARCH_EVENTS.RESULT_CLICKED,
        properties: {
          click_phase: active.completed ? 'after_latest_response' : 'before_latest_response',
          input_to_click_bucket: bucketDuration(inputToClickMs),
          input_to_click_ms: inputToClickMs,
          menu_context: menuContext,
          platform,
          position_bucket: bucketPosition(position),
          position_scope: 'visible_results',
          ...(renderToClickMs === undefined
            ? {}
            : {
                render_to_click_bucket: bucketClickDecision(renderToClickMs),
                render_to_click_ms: renderToClickMs,
              }),
          result_type: resultType,
          search_session_id: session.id,
          spm: GLOBAL_SEARCH_SPM.RESULT_CLICKED,
          surface: 'command_menu',
          type_filter: typeFilter ?? 'all',
        },
      });
    },
    [enabled, menuContext, platform, typeFilter],
  );

  return { trackFilterChange, trackInputChange, trackResultClick };
};
