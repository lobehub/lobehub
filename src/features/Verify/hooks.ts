import { useCallback, useEffect } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import type { VerifyReportSummaryPage } from '@/services/verify';
import { verifyService } from '@/services/verify';

const VERIFY_REPORT_PAGE_SIZE = 30;

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
  useClientDataSWR(verifyRunId ? verifyKeys.reportBundle(verifyRunId) : null, () =>
    verifyService.getReportBundle(verifyRunId!),
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
    { revalidateFirstPage: false },
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

  // A subsequent page is genuinely in flight only when it hasn't errored — an
  // errored page also leaves its slot undefined, but must not read as loading.
  const isLoadingMore =
    !error && (isLoading || (size > 0 && !!data && typeof data[size - 1] === 'undefined'));

  // Pause the sentinel while an error is showing so it can't hot-loop the failed
  // page; the panel offers a manual retry (`reload`) instead.
  const hasMore = !reachedEnd && !error;

  return {
    error,
    hasMore,
    isLoadingInitial: isLoading,
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
export const useRubrics = () =>
  useClientDataSWR(verifyKeys.rubrics(), () => verifyService.listRubrics());

/** The workspace's reusable atomic criteria. */
export const useCriteria = () =>
  useClientDataSWR(verifyKeys.criteria(), () => verifyService.listCriteria());

/** The criteria a rubric groups, in rubric order. Pass null to skip. */
export const useRubricCriteria = (rubricId: string | null | undefined) =>
  useClientDataSWR(rubricId ? verifyKeys.rubricCriteria(rubricId) : null, () =>
    verifyService.getRubricCriteria(rubricId!),
  );
