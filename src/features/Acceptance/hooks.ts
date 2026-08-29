import type { AcceptanceSubjectType } from '@lobechat/types';
import { useCallback, useEffect } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import type { VerifyReportSummaryPage } from '@/services/verify';
import { verifyService } from '@/services/verify';

const VERIFY_REPORT_PAGE_SIZE = 30;
const VERIFY_REPORT_SWR_CONFIG = {
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
} as const;

// The acceptance bundle is a LIVE decision surface — rounds run and reviews land
// while the reviewer is away — so unlike the immutable report snapshots it
// revalidates on focus/reconnect. Coming back to the tab shows the current state
// without a manual refresh (focus is throttled by SWR's default 5s).
const ACCEPTANCE_BUNDLE_SWR_CONFIG = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
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

/** Plan + rollup status for one Agent Run. Pass null operationId to skip. */
export const useVerifyState = (operationId: string | null) =>
  useClientDataSWR(operationId ? verifyKeys.state(operationId) : null, () =>
    verifyService.getVerifyState(operationId!),
  );

/** Per-item check results for one Agent Run. Pass null operationId to skip. */
export const useVerifyResults = (operationId: string | null) =>
  useClientDataSWR(operationId ? verifyKeys.results(operationId) : null, () =>
    verifyService.listResults(operationId!),
  );

/** Full standalone report bundle (run + report + results + evidence) by verifyRunId. */
export const useVerifyReportBundle = (verifyRunId: string | null) =>
  useClientDataSWR(
    verifyRunId ? verifyKeys.reportBundle(verifyRunId) : null,
    () => verifyService.getReportBundle(verifyRunId!),
    VERIFY_REPORT_SWR_CONFIG,
  );

export { useAcceptanceBundle } from './Viewer/useAcceptanceBundle';

/** The optional acceptance aggregate attached to a task/topic/document subject. */
export const useAcceptanceBySubject = (
  subjectType: AcceptanceSubjectType,
  subjectId: string | null,
) =>
  useClientDataSWR(
    subjectId ? verifyKeys.acceptanceBySubject(subjectType, subjectId) : null,
    () => verifyService.getAcceptanceBySubject(subjectType, subjectId!),
    {
      ...ACCEPTANCE_BUNDLE_SWR_CONFIG,
      // A task can mount before its first Verify Run creates the aggregate.
      // Discover that server-side transition without requiring focus/reload,
      // then stop polling as soon as the Acceptance exists.
      refreshInterval: getAcceptanceBySubjectRefreshInterval,
    },
  );

/**
 * The caller's recent acceptance aggregates (with subject headers) — the list
 * panel. `limit` widens the recency window for surfaces that must reach further
 * back than the panel does (the merge target picker).
 *
 * A widened window is its own SWR key. Mutations invalidate the whole
 * `verify:acceptances` key family so every filter / limit / search variant
 * revalidates together.
 */
export const useAcceptanceList = (
  enabled: boolean,
  options?: {
    filter?: 'active' | 'all' | 'completed';
    limit?: number;
    q?: string;
    revalidateOnMount?: boolean;
  },
) =>
  useClientDataSWR(
    enabled ? verifyKeys.acceptances(options?.limit, options?.q, options?.filter) : null,
    () =>
      verifyService.listAcceptances({
        filter: options?.filter,
        limit: options?.limit,
        q: options?.q,
      }),
    {
      ...VERIFY_REPORT_SWR_CONFIG,
      ...(options?.revalidateOnMount ? { revalidateOnMount: true } : {}),
    },
  );

/**
 * Acceptance status for a known subject set — one read for a whole list.
 *
 * Not `useAcceptanceList`: that feed is capped at the newest rows across every
 * subject type, so any subject pushed past the cap would read as having no
 * acceptance at all. Revalidates on focus like the bundle, because a delivery
 * that lands while the tab sits open has to show up without a reload.
 */
export const useAcceptanceStatuses = (
  subjectType: AcceptanceSubjectType,
  subjectIds: string[],
  enabled = true,
) =>
  useClientDataSWR(
    enabled && subjectIds.length > 0
      ? verifyKeys.acceptanceStatuses(subjectType, subjectIds)
      : null,
    () => verifyService.listAcceptanceStatuses(subjectType, subjectIds),
    ACCEPTANCE_BUNDLE_SWR_CONFIG,
  );

/**
 * Cursor-paginated, infinite-scrolling report summaries. `q` drives a
 * server-side title search (spanning the whole history, not just loaded pages);
 * changing it collapses back to the first page.
 */
export const useVerifyReportSummariesInfinite = (q: string) => {
  const workspaceId = useActiveWorkspaceId();

  const getKey = useCallback(
    (_index: number, previous: VerifyReportSummaryPage | null) => {
      // Stop paging once the previous page reported no further cursor.
      if (previous && previous.nextCursor === null) return null;
      return verifyKeys.reportSummaries(workspaceId, q, previous?.nextCursor ?? undefined);
    },
    [q, workspaceId],
  );

  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, , query, cursor]: readonly [string, string, string, string]) =>
      verifyService.listReportSummaries({
        cursor: cursor || undefined,
        limit: VERIFY_REPORT_PAGE_SIZE,
        q: query || undefined,
      }),
    { ...VERIFY_REPORT_SWR_CONFIG, revalidateFirstPage: false },
  );

  // A new search term starts a fresh key series; collapse size back to 1 so we
  // don't cascade-fetch as many pages as the previous query had loaded.
  useEffect(() => {
    setSize(1);
  }, [q, setSize]);

  const loadMore = useCallback(() => {
    void setSize((s) => s + 1);
  }, [setSize]);
  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

  // SWR leaves a failed/pending page's slot `undefined`, so guard the holes.
  const items = data?.flatMap((page) => page?.items ?? []) ?? [];
  const lastLoadedPage = data?.findLast(Boolean);
  const reachedEnd = lastLoadedPage ? lastLoadedPage.nextCursor === null : false;
  const hasLoadedPages = data !== undefined;

  // Keep already-loaded rows visible while SWR revalidates after a focus/remount.
  // A subsequent page is genuinely in flight only when the loaded page array has
  // an unresolved tail slot; raw `isLoading` also covers first-load revalidation.
  const isLoadingInitial = !error && isLoading && !hasLoadedPages;
  const isLoadingMore =
    !error && hasLoadedPages && size > 0 && typeof data[size - 1] === 'undefined';

  // Pause the sentinel while an error is showing so it can't hot-loop the failed
  // page; the panel offers a manual retry (`reload`) instead.
  const hasMore = !reachedEnd && !error;

  return {
    error,
    hasMore,
    isLoadingInitial,
    isLoadingMore,
    isValidating,
    items,
    loadMore,
    reload,
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
