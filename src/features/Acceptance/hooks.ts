import type { CreatableAcceptanceSubjectType } from '@lobechat/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import type {
  AcceptanceBySubject,
  AcceptanceListFilter,
  AcceptanceListItem,
  AcceptanceListQuery,
} from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useVerifyStore, verifySelectors } from '@/store/verify';
import type { AcceptanceListParams, AcceptancePageParams } from '@/store/verify/projection';

const VERIFY_REPORT_SWR_CONFIG = {
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
} as const;

/**
 * Poll until the aggregate exists AND stops moving.
 *
 * Discovery was the only case handled before, so a task page left open during
 * a goal loop kept rendering whatever state it first saw — "awaiting
 * verification" straight through verifying, delivery and acceptance — until a
 * focus or remount happened to refetch.
 */
const TERMINAL_ACCEPTANCE_STATUSES = new Set(['accepted', 'closed']);

export const getAcceptanceBySubjectRefreshInterval = (acceptance: unknown) => {
  if (!acceptance) return 2000;
  const status = (acceptance as { status?: string }).status;
  return status && TERMINAL_ACCEPTANCE_STATUSES.has(status) ? 0 : 5000;
};

/**
 * One Agent Run's verify card, read from the verify store's replica of
 * `verifyRunMap`: a settled run paints from IndexedDB on reload, then refreshes.
 */
const useVerifyRun = (operationId: string | null) => {
  const useFetchVerifyRun = useVerifyStore((s) => s.useFetchVerifyRun);
  const run = useVerifyStore(verifySelectors.verifyRun(operationId));
  const sync = useFetchVerifyRun(operationId);

  return { mutate: sync.revalidate, run };
};

/** Plan + rollup status for one Agent Run. Pass null operationId to skip. */
export const useVerifyState = (operationId: string | null) => {
  const { mutate, run } = useVerifyRun(operationId);
  return { data: run?.state, mutate };
};

/** Per-item check results for one Agent Run. Pass null operationId to skip. */
export const useVerifyResults = (operationId: string | null) => {
  const { mutate, run } = useVerifyRun(operationId);
  return { data: run?.results, mutate };
};

/** Full standalone report bundle (run + report + results + evidence) by verifyRunId. */
export const useVerifyReportBundle = (verifyRunId: string | null) =>
  useClientDataSWR(
    verifyRunId ? verifyKeys.reportBundle(verifyRunId) : null,
    () => verifyService.getReportBundle(verifyRunId!),
    VERIFY_REPORT_SWR_CONFIG,
  );

export { useAcceptanceBundle } from './Viewer/useAcceptanceBundle';

/** What `useAcceptanceBySubject` hands its readers — the former SWR response shape. */
export interface AcceptanceBySubjectSync {
  /** The attachment from the replica view; `undefined` until hydrated or fetched. */
  data: AcceptanceBySubject | undefined;
  error: unknown;
  /** Nothing to show yet, and a hydration or fetch is still outstanding. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-read the attachment and resolve with the freshly read value. */
  mutate: () => Promise<AcceptanceBySubject | undefined>;
}

/**
 * The optional acceptance aggregate attached to a task/topic/document subject,
 * read from the verify store's replica of `acceptanceBySubjectMap`. A subject
 * can mount before its first Verify Run creates the aggregate, so the sync
 * polls fastest until one exists and then keeps it live until it settles.
 */
export const useAcceptanceBySubject = (
  subjectType: CreatableAcceptanceSubjectType,
  subjectId: string | null,
): AcceptanceBySubjectSync => {
  const useFetchAcceptanceBySubject = useVerifyStore((s) => s.useFetchAcceptanceBySubject);
  const key = subjectId ? `${subjectType}:${subjectId}` : undefined;
  const data = useVerifyStore((s) => (key ? s.acceptanceBySubjectMap[key] : undefined));

  const sync = useFetchAcceptanceBySubject(subjectType, subjectId, {
    refreshInterval: getAcceptanceBySubjectRefreshInterval(data),
  });

  // A subject without an acceptance polls every 2s. Once a request for this key
  // has settled, "no acceptance" is a known answer: later polls must not flip the
  // caller back to its loading placeholder (that swapped the task's Acceptance
  // trigger for a spinner on every tick and made the section jump).
  const validatingKeyRef = useRef<string | undefined>(undefined);
  const [settledKey, setSettledKey] = useState<string>();
  useEffect(() => {
    if (!key) return;
    if (sync.isValidating) {
      validatingKeyRef.current = key;
      return;
    }
    if (validatingKeyRef.current === key) setSettledKey(key);
  }, [key, sync.isValidating]);

  return {
    data,
    error: sync.error,
    // A read with no subject has nothing to load — never report it as loading.
    isLoading:
      !!subjectId &&
      !data &&
      !sync.error &&
      (!sync.isHydrated || (sync.isValidating && settledKey !== key)),
    isValidating: sync.isValidating,
    mutate: async () => {
      await sync.revalidate();
      return key ? useVerifyStore.getState().acceptanceBySubjectMap[key] : undefined;
    },
  };
};

const EMPTY_ITEMS: AcceptanceListItem[] = [];

/**
 * The caller's recent acceptance aggregates (with subject headers), read from
 * the verify store's replica of `acceptanceListMap`. `limit` widens the recency
 * window for surfaces that must reach further back than the panel does (the
 * merge target picker); `fresh` skips the shared dedupe window on mount.
 *
 * Every write revalidates all list entries together
 * (`useVerifyStore.getState().refreshAcceptanceLists()`).
 */
export const useAcceptanceList = (
  enabled: boolean,
  options?: AcceptanceListQuery & {
    fresh?: boolean;
    limit?: number;
    q?: string;
  },
) => {
  const params: AcceptanceListParams | null = enabled
    ? {
        filter: options?.filter,
        limit: options?.limit,
        projectId: options?.projectId,
        q: options?.q,
        scope: options?.scope,
        source: options?.source,
      }
    : null;
  const useFetchAcceptanceList = useVerifyStore((s) => s.useFetchAcceptanceList);
  const sync = useFetchAcceptanceList(params, { fresh: options?.fresh });
  const entry = useVerifyStore(verifySelectors.acceptanceList(params));
  const confirmed = useVerifyStore(verifySelectors.isAcceptanceListConfirmed(params));

  // A restored empty list is only the last session's answer: until the server
  // confirms it, "no acceptances" is still loading (not onboarding or an empty state).
  const data = entry && (entry.length > 0 || confirmed) ? entry : undefined;
  // A failed background refresh keeps the last list on screen.
  const error = data ? undefined : sync.error;

  return {
    data,
    error,
    isLoading: enabled && !data && !error,
    mutate: sync.revalidate,
  };
};

/** Rounds, evidence files and bytes a delete would purge. Pass null to skip. */
export const useAcceptancePurgePreview = (acceptanceId: string | null) =>
  useClientDataSWR(
    acceptanceId ? verifyKeys.acceptancePurgePreview(acceptanceId) : null,
    () => verifyService.getAcceptancePurgePreview([acceptanceId!]),
    VERIFY_REPORT_SWR_CONFIG,
  );

/**
 * The panel's scroll feed: keyset pages, newest first, with the in-progress /
 * completed split applied server-side (see `acceptance.listPage`), read from
 * the verify store's paged replica (`acceptancePageMap`). The head page
 * survives a reload, so the panel paints its last rows before the network.
 *
 * A `null` filter disables the feed entirely — that is how the panel hands off
 * to the flat search read. Switching to a feed collapses it back to its head
 * page rather than refetching as many pages as an earlier visit had open.
 */
export const useAcceptanceListInfinite = (
  filter: AcceptanceListFilter | null,
  query: Omit<AcceptanceListQuery, 'filter'> = {},
) => {
  const { projectId, scope, source } = query;
  const params = useMemo<AcceptancePageParams | null>(
    () => (filter ? { filter, projectId, scope, source } : null),
    [filter, projectId, scope, source],
  );
  const useFetchAcceptancePage = useVerifyStore((s) => s.useFetchAcceptancePage);
  const sync = useFetchAcceptancePage(params);
  const entry = useVerifyStore(verifySelectors.acceptancePage(params));
  const confirmed = useVerifyStore(verifySelectors.isAcceptancePageConfirmed(params));

  useEffect(() => {
    if (params) useVerifyStore.getState().collapseAcceptancePage(params);
  }, [params]);

  const loadMore = useCallback(() => {
    if (params) void useVerifyStore.getState().loadMoreAcceptancePage(params);
  }, [params]);

  // A restored empty head is not a settled "no acceptances" until the server says so.
  const settled = !!entry && (entry.items.length > 0 || confirmed);
  const items = settled ? entry.items : EMPTY_ITEMS;
  // A failed background refresh keeps the rows on screen; only a feed with
  // nothing to show reads as failed.
  const error = settled ? undefined : sync.error;
  const loadMoreError = settled ? entry.loadMoreError : undefined;

  return {
    error,
    // Pause the sentinel while a page error is showing so it cannot hot-loop
    // the failed page; the panel offers a manual retry instead.
    hasMore: settled && entry.hasMore && !loadMoreError,
    isLoadingInitial: !!params && !settled && !error,
    isLoadingMore: settled && !!entry.isLoadingMore,
    items,
    loadMore,
    loadMoreError,
    mutate: sync.revalidate,
  };
};

/** Model / token / latency for an LLM verifier judgment. Pass null to skip. */
export const useVerifierTracing = (tracingId: string | null | undefined) =>
  useClientDataSWR(tracingId ? verifyKeys.tracing(tracingId) : null, () =>
    verifyService.getVerifierTracing(tracingId!),
  );

/** The criterion's original judging rule, stored in its instruction document. */
export const useVerifyInstruction = (documentId: string | null | undefined) =>
  useClientDataSWR(documentId ? verifyKeys.instruction(documentId) : null, () =>
    documentService.getDocumentById(documentId!),
  );

/** A rubric and its run-policy config (e.g. maxRepairRounds). Pass null to skip. */
export const useRubric = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? verifyKeys.rubric(rubricId) : null, () =>
    verifyService.getRubric(rubricId!),
  );

/** The workspace's reusable rubric templates (delivery-standard groups). */
export const useRubrics = (enabled = true) =>
  useClientDataSWR(enabled ? verifyKeys.rubrics() : null, () => verifyService.listRubrics());

/** The workspace's reusable atomic criteria. */
export const useCriteria = () =>
  useClientDataSWR(verifyKeys.criteria(), () => verifyService.listCriteria());

/** The criteria a rubric groups, in rubric order. Pass null to skip. */
export const useRubricCriteria = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? verifyKeys.rubricCriteria(rubricId) : null, () =>
    verifyService.getRubricCriteria(rubricId!),
  );
