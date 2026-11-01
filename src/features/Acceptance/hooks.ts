import type { CreatableAcceptanceSubjectType } from '@lobechat/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import type {
  AcceptanceBySubject,
  AcceptanceListFilter,
  AcceptanceListPage,
  AcceptanceListQuery,
} from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useVerifyStore, verifySelectors } from '@/store/verify';

const ACCEPTANCE_PAGE_SIZE = 30;
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
  options?: AcceptanceListQuery & {
    limit?: number;
    q?: string;
    revalidateOnMount?: boolean;
  },
) =>
  useClientDataSWR(
    enabled
      ? verifyKeys.acceptances(options?.limit, options?.q, {
          filter: options?.filter,
          projectId: options?.projectId,
          scope: options?.scope,
          source: options?.source,
        })
      : null,
    () =>
      verifyService.listAcceptances({
        filter: options?.filter,
        limit: options?.limit,
        projectId: options?.projectId,
        q: options?.q,
        scope: options?.scope,
        source: options?.source,
      }),
    {
      ...VERIFY_REPORT_SWR_CONFIG,
      ...(options?.revalidateOnMount ? { revalidateOnMount: true } : {}),
    },
  );

/** Rounds, evidence files and bytes a delete would purge. Pass null to skip. */
export const useAcceptancePurgePreview = (acceptanceId: string | null) =>
  useClientDataSWR(
    acceptanceId ? verifyKeys.acceptancePurgePreview(acceptanceId) : null,
    () => verifyService.getAcceptancePurgePreview([acceptanceId!]),
    VERIFY_REPORT_SWR_CONFIG,
  );

/**
 * The panel's scroll feed: keyset pages, newest first, with the in-progress /
 * completed split applied server-side (see `acceptance.listPage`).
 *
 * A `null` filter disables the feed entirely — that is how the panel hands off
 * to the flat search read. Changing the filter starts a fresh key series, so the
 * loaded depth collapses back to one page rather than cascading a refetch of as
 * many pages as the previous view had open.
 */
export const useAcceptanceListInfinite = (
  filter: AcceptanceListFilter | null,
  query: Omit<AcceptanceListQuery, 'filter'> = {},
) => {
  const workspaceId = useActiveWorkspaceId();
  const { projectId, scope, source } = query;

  const getKey = useCallback(
    (_index: number, previous: AcceptanceListPage | null) => {
      if (previous && previous.nextCursor === null) return null;
      if (!filter) return null;
      return verifyKeys.acceptancePage(
        workspaceId ?? undefined,
        { filter, projectId, scope, source },
        previous?.nextCursor ?? undefined,
      );
    },
    [filter, projectId, scope, source, workspaceId],
  );

  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite(
    getKey,
    // Read the narrowing from the closure, not the key: the key spells the
    // unfiled project as a sentinel string, the server wants `null`.
    (key: readonly string[]) =>
      verifyService.listAcceptancePage({
        cursor: key.at(-1) || undefined,
        filter: filter ?? undefined,
        limit: ACCEPTANCE_PAGE_SIZE,
        projectId,
        scope,
        source,
      }),
    { ...VERIFY_REPORT_SWR_CONFIG, revalidateFirstPage: false },
  );

  useEffect(() => {
    setSize(1);
  }, [filter, projectId, scope, source, workspaceId, setSize]);

  const loadMore = useCallback(() => {
    void setSize((s) => s + 1);
  }, [setSize]);

  // SWR leaves a failed/pending page's slot `undefined`, so guard the holes.
  const items = data?.flatMap((page) => page?.items ?? []) ?? [];
  const lastLoadedPage = data?.findLast(Boolean);
  const reachedEnd = lastLoadedPage ? lastLoadedPage.nextCursor === null : false;
  const hasLoadedPages = data !== undefined;

  const isLoadingInitial = !error && isLoading && !hasLoadedPages;
  const isLoadingMore =
    !error && hasLoadedPages && size > 0 && typeof data[size - 1] === 'undefined';

  return {
    error,
    // Pause the sentinel while an error is showing so it cannot hot-loop the
    // failed page; the panel offers a manual retry instead.
    hasMore: !reachedEnd && !error,
    isLoadingInitial,
    isLoadingMore,
    items,
    loadMore,
    mutate,
  };
};

/**
 * Acceptance status for a known subject set — one read for a whole list.
 *
 * Not `useAcceptanceList`: that feed is capped at the newest rows across every
 * subject type, so any subject pushed past the cap would read as having no
 * acceptance at all. Revalidates on focus like the bundle, because a delivery
 * that lands while the tab sits open has to show up without a reload.
 */
export const useAcceptanceStatuses = (
  subjectType: CreatableAcceptanceSubjectType,
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
